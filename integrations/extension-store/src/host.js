import { createHash } from "node:crypto";
import { getDshRuntimeVersion } from "@deepseek-ai/dsh-app-boot";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z as stateSchema } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import * as mcp from "@deepseek-ai/dsh-mcp-client";
import { GithubTransport } from "./github.js";
import { ExtensionStore } from "./store.js";
import { configureConnection } from "./connections.js";
import { RuntimeManager } from "./runtime.js";
import { trustedRequest, json, body } from "./http.js";
import { validateOperation } from "./operations.js";
import { canInstall } from "./contracts.js";
import { isPythonDependency } from './dependency-groups.js';
export const name = "bc-extension-store";
export const inject = [
  "webServer",
  "connection",
  "pluginManager",
  "credentials",
  "profileContext",
  "agents",
  "workspaceRegistry",
  "storageDomain",
  "subprocess",
];
export const Config = z.object({
  credentialReference: z
    .string()
    .pattern(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .default("BC_EXTENSION_GITHUB_TOKEN"),
});
export async function apply(ctx, config = {}) {
  const reference = credentialRef(
    config.credentialReference ?? "BC_EXTENSION_GITHUB_TOKEN",
  );
  const directory = join(ctx.profileContext.dir, "bc-extension-store");
  const seed = JSON.parse(
    await readFile(new URL("../catalog.json", import.meta.url), "utf8"),
  );
  const publicKey = await readFile(
    new URL("../catalog-public-key.pem", import.meta.url),
    "utf8",
  );
  const domain = await ctx.storageDomain.open(
    defineDomain({
      name: "bc_extension_store",
      version: 1,
      tables: {
        state: domainTable(
          stateSchema.object({
            schemaVersion: stateSchema.literal(1),
            records: stateSchema.array(stateSchema.unknown()),
            workspaceEnabled: stateSchema.array(
              stateSchema.tuple([stateSchema.string(), stateSchema.string()]),
            ),
          }),
        ),
      },
    }),
  );
  ctx.effect(() => () => domain.close(), "bc-extension-store.persistence");
  const table = domain.table("state");
  const stateKey = createHash("sha256")
    .update(ctx.profileContext.dir)
    .digest("hex");
  const transport = new GithubTransport(
    async () => (await ctx.credentials.resolve(reference))?.value,
  );
  const store = new ExtensionStore({
    directory,
    transport,
    publicKey,
    persistence: {
      read: async () => table.get(stateKey),
      write: async (value) => table.put(stateKey, value),
    },
    manager: ctx.pluginManager,
    subprocess: ctx.subprocess,
    platform: process.platform,
    bcVersion: getDshRuntimeVersion(),
    seed,
  });
  await store.load();
  await store.downloaded();
  function workspaceFor(session) {
    const workspace = ctx.workspaceRegistry
      .list()
      .find((w) => w.sessionIds.includes(session));
    if (!workspace)
      throw Error("Session is not attached to a registered workspace");
    return workspace.id;
  }
  const runtime = new RuntimeManager(async ({ workspace, session, entry, signal }) => {
    const agent = ctx.agents.get(session);
    if (!agent || workspaceFor(session) !== workspace)
      throw Error("Live session/workspace ownership mismatch");
    if (!entry.runtime || entry.kind !== "mcp")
      throw Error("No qualified MCP runtime");
    const dependencyChecks = await store.inspectEntryDependencies(entry, signal);
    const missingDependency = dependencyChecks.find(result => !result.available);
    if (missingDependency)
      throw Error(`${missingDependency.title}: ${missingDependency.reason ?? 'a compatible runtime is required'}`);
    const serverName = `bc_${createHash("sha256").update(entry.id).digest("hex").slice(0, 16)}`;
    const settings = {
      ...entry.runtime,
      serverName,
      allowedTools: [...entry.tools],
      env: {},
      cwd: agent.session.header?.cwd ?? "",
      headers: {},
      toolCallTimeoutMs: 60000,
      failOnStartupError: true,
      maxInstructionBytes: 32768,
      reconnect: {
        enabled: true,
        initialDelayMs: 500,
        maxDelayMs: 30000,
        maxAttempts: 10,
      },
    };
    const managedCommand = await store.resolveRuntimeCommand(entry, settings.command);
    if (managedCommand) settings.command = managedCommand;
    else if (settings.command === 'python' && process.platform !== 'win32'
      && (entry.dependencyIds ?? []).some(isPythonDependency)) settings.command = 'python3';
    if (entry.credentialReference) {
      const ref = credentialRef(entry.credentialReference);
      const secret = await ctx.credentials.resolve(ref);
      if (!secret) throw Error("Connect this extension before starting it");
      if (settings.transport === "streamable-http")
        settings.headers.Authorization = `Bearer ${secret.value}`;
      else throw Error("Stdio credential mapping needs qualification");
    }
    const fiber = agent.ctx.plugin(mcp, settings);
    try {
      await fiber;
    } catch (error) {
      await fiber.dispose();
      throw error;
    }
    const names = () =>
      agent.ctx.tools
        .schemas(agent)
        .filter((t) => t.name.startsWith(`mcp__${serverName}__`));
    const allowed = new Set(entry.tools.map((raw) => mcp.publicToolName(serverName, raw)));
    if (
      !allowed.size ||
      names().some(
        (t) => !allowed.has(t.name),
      )
    ) {
      await fiber.dispose();
      throw Error("Connector tool group does not match qualified catalog");
    }
    fiber.ctx.on("tools/execute", async (exec, next) => {
      if (
        !exec.name.startsWith(`mcp__${serverName}__`) ||
        exec.agent?.id !== session
      )
        return next();
      if (!allowed.has(exec.name)) throw Error("Tool is outside the qualified connector allowlist");
      const release = runtime.lease(workspace, session, entry.id);
      try {
        return await next();
      } finally {
        release();
      }
    });
    return {
      persistent: Boolean(entry.persistent),
      invoke: async (tool) => {
        if (tool !== "discover")
          throw Error(
            "Call exposed connector tools through the native executor",
          );
        return names();
      },
      dispose: () => fiber.dispose(),
    };
  });
  for (const [workspace, id] of store.workspaceEnabled) {
    const record = store.installed.find((r) => r.id === id);
    if (
      record?.descriptor.scope === "session" &&
      canInstall(record.descriptor, process.platform, store.options.bcVersion)
    )
      runtime.enable(workspace, record.descriptor);
  }
  const snapshot = async () => ({
    ...store.view(),
    credential: await ctx.credentials.describe(reference),
    workspaces: ctx.workspaceRegistry
      .list()
      .map((w) => ({ id: w.id, title: w.title })),
    running: runtime.snapshot(),
    bundles: (await ctx.pluginManager.listBundles()).map((b) => ({
      name: b.name,
      enabled: b.enabled,
      error: b.error?.message,
    })),
    workspaceEnabled: [...runtime.enabled.keys()].map((k) => JSON.parse(k)),
  });
  const sweep = setInterval(() => void runtime.sweep().catch(() => {}), 60000);
  sweep.unref?.();
  const handler = async (req, res) => {
    const rejection = ctx.connection.requestRejection(req);
    if (rejection !== undefined || !trustedRequest(req)) {
      json(res, rejection ?? 403, {
        error: "Authenticated first-party application access required",
      });
      return;
    }
    try {
      if (req.method === "GET") {
        json(res, 200, await snapshot());
        return;
      }
      if (req.method !== "POST") {
        json(res, 405, { error: "Method not supported" });
        return;
      }
      const request = validateOperation(await body(req));
      const disconnect = new AbortController();
      req.once("aborted", () => disconnect.abort());
      res.once("close", () => { if (!res.writableEnded) disconnect.abort(); });
      switch (request.action) {
        case "inspect-dependencies": {
          const entry = store.catalog.entries.find(e => e.id === request.id);
          if (!entry) throw Error('Unknown extension');
          json(res, 200, { ...(await snapshot()), inspectedDependencies: {
            id: entry.id, results: await store.inspectEntryDependencies(entry, disconnect.signal),
          } });
          return;
        }
        case "refresh":
          await store.refresh(disconnect.signal);
          break;
        case "connect":
          if (
            typeof request.token !== "string" ||
            request.token.length < 10 ||
            request.token.length > 4096
          )
            throw Error("Enter a GitHub credential");
          await ctx.credentials.set(reference, request.token);
          break;
        case "disconnect":
          await ctx.credentials.unset(reference);
          break;
        case "connect-extension":
        case "disconnect-extension":
          await configureConnection(
            {
              credentials: ctx.credentials,
              installed: store.installed,
              runtime,
            },
            request,
          );
          break;
        case "install":
          if (runtime.hasWork(request.id))
            throw Error(
              "Stop extension runtimes before installation or update",
            );
          await store.install(request.id, disconnect.signal);
          break;
        case "setup-dependencies":
          if (runtime.hasWork(request.id))
            throw Error("Stop extension runtimes before setting up dependencies");
          await store.installDependencies(request.id, disconnect.signal);
          break;
        case "remove-dependency":
          if (ctx.agents.list().some((agent) => agent.status === "running"))
            throw Error("Wait for active agent work to finish before removing a managed runtime");
          {
            const bundle = store.dependencies.records.find(item => item.id === request.id && item.version === request.version);
            const provided = bundle?.verified ? new Set(Object.keys(bundle.bundle.provides)) : undefined;
            if (store.installed.some(record => runtime.hasWork(record.id)
              && (provided
                ? (record.descriptor.dependencyIds ?? []).some(id => provided.has(id))
                : (record.descriptor.dependencyIds ?? []).length > 0)))
              throw Error("Stop dependent extension runtimes before removing this managed runtime");
          }
          await store.removeDependency(request.id, request.version);
          break;
        case "cancel":
          store.cancel(request.requestId);
          break;
        case "profile-enable":
          if (ctx.agents.list().some((a) => a.status === "running"))
            throw Error(
              "Wait for active agent work to finish before changing profile-global plugins",
            );
          if (typeof request.enabled !== "boolean")
            throw Error("Invalid activation choice");
          if (request.enabled) {
            const record = store.installed.find(item => item.id === request.id);
            if (record) {
              const missing = (await store.inspectEntryDependencies(record.descriptor, disconnect.signal, { managed: false }))
                .find(result => !result.available);
              if (missing) throw Error(`${missing.title}: ${missing.reason ?? 'a compatible local runtime is required'}`);
            }
          }
          await store.profileEnabled(request.id, request.enabled);
          break;
        case "workspace-enable": {
          const entry = store.installed.find(
            (e) => e.id === request.id,
          )?.descriptor;
          if (
            !entry ||
            !canInstall(entry, process.platform, store.options.bcVersion) ||
            !store.installed.some((x) => x.id === entry.id)
          )
            throw Error("Install a qualified release first");
          if (!ctx.workspaceRegistry.get(request.workspace))
            throw Error("Unknown workspace");
          if (request.enabled === true) {
            const missing = (await store.inspectEntryDependencies(entry, disconnect.signal))
              .find(result => !result.available);
            if (missing) throw Error(`${missing.title}: ${missing.reason ?? 'a compatible runtime is required'}`);
            runtime.enable(request.workspace, entry);
          } else if (request.enabled === false) {
            await runtime.disable(request.workspace, entry.id);
          } else throw Error("Invalid activation choice");
          await store.activation(request.workspace, entry.id, request.enabled);
          break;
        }
        case "rollback":
          await store.rollback(request.id);
          break;
        case "remove":
          if (ctx.agents.list().some((a) => a.status === "running"))
            throw Error("Wait for active agent work to finish before removal");
          if (runtime.hasWork(request.id))
            throw Error("Stop extension runtimes before removal");
          await store.remove(request.id);
          break;
        case "clear-cache":
          await store.clearCache();
          break;
        default:
          throw Error("Unknown extension operation");
      }
      json(res, 200, await snapshot());
    } catch (error) {
      json(res, 400, {
        error:
          error instanceof Error ? error.message : "Extension operation failed",
      });
    }
  };
  const off = ctx.webServer.register({
    kind: "exact",
    path: "/api/bc-extension-store",
    handler,
  });
  ctx.inject(["tools"], (toolsCtx) =>
    toolsCtx.effect(() =>
      toolsCtx.tools.register({
        name: "extension_load",
        description:
          "Start a previously installed and workspace-enabled extension on demand. Returns its native tools; call those tools normally afterward. Does not install packages or change account permissions.",
        parameters: {
          id: {
            type: "string",
            required: true,
            description: "Extension catalog ID.",
          },
        },
        output: {
          schema: { type: "json" },
          render: (_args, value) => [
            { type: "text", text: JSON.stringify(value) },
          ],
        },
        execute: async (args, exec) => {
          const session = exec.agent?.id;
          if (!session) throw Error("Live agent required");
          const entry = store.installed.find(
            (e) => e.id === args.id,
          )?.descriptor;
          if (
            !entry ||
            !canInstall(entry, process.platform, store.options.bcVersion)
          )
            throw Error("Qualified extension required");
          return runtime.invoke(
            workspaceFor(session),
            session,
            entry,
            "discover",
            {},
            exec.signal,
          );
        },
      }),
    ),
  );
  ctx.effect(() => async () => {
    off();
    clearInterval(sweep);
    await runtime.dispose();
    await store.dispose();
  });
}
