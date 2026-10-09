import type { IncomingMessage, ServerResponse } from "node:http";
import type { HostContext, ProviderControl, Agent } from "./host-types.js";
import type { Log, Serialize, CreateInput, UploadInput, SkillRequest, RepositoryInput, ScopeOptions } from "./types.js";
import type { ProviderCandidate } from "./core.js";
import type { CodedError } from "./types.js";
// dsh-skills-manager host: HTTP backend for the settings panel (webServer prefix routes)
// - Host routes depend only on Node built-ins and local core.js; ZIP extraction is encapsulated in core
// - Routes: state, enable/disable, details, create, import, and trash
// - Every endpoint validates the Host trusted by DSH Web; write endpoints also validate the request marker and JSON
// - Enable/disable for all sources updates only manager state and never changes source Skill files
// - Skills in $DSH_HOME/skills and the active project's .dsh/skills can be created, trashed, and restored; Agent source files remain read-only

import { appendFile, rename, rm, stat } from "node:fs/promises";
import {
  state,
  setSkillEnabled,
  setSourceEnabled,
  deleteSkill,
  restoreTrash,
  permanentlyDeleteTrash,
  importSkill,
  importUploadedSkill,
  browseDirectories,
  createSkill,
  skillDetail,
  listProviderCandidates,
  getProviderSkill,
  userRoots,
  projectRoots,
  logPath,
} from "./core.js";
import { registerPluginUpdater } from "./plugin-updater.js";
import { createRepositoryManager } from "./repositories.js";

const name = "skills-manager";
const inject = ["webServer", "webRuntime", "skills", "tools", "sessions", "connection"];
const CLIENT_MARKER_HEADER = "x-dsh-skills-manager";
const MAX_LOG_BYTES = 1 << 20;
// Folder uploads allow 64 MiB of raw content; Base64 adds about one-third, with extra room for up to 1,000 paths.
const MAX_UPLOAD_BODY_BYTES = 88 << 20;

function makeLog(): Log {
  const file = logPath();
  let queue = Promise.resolve();
  return async (event, detail) => {
    queue = queue.then(async () => {
      try {
        const current = await stat(file).catch(() => null);
        if (current && current.size >= MAX_LOG_BYTES) {
          await rm(`${file}.1`, { force: true });
          await rename(file, `${file}.1`);
        }
        await appendFile(file, `${JSON.stringify({ ts: new Date().toISOString(), event, detail })}\n`, "utf8");
      } catch {
        /* Logging failures must not block the main flow. */
      }
    });
    await queue;
  };
}

function readBody(req: IncomingMessage, limit = 1 << 20) {
  return new Promise<RequestBody>((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks: Buffer[] = [];
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on("data", (c) => {
      if (settled) return;
      size += c.length;
      if (size > limit) {
        const error: CodedError = new Error("body too large");
        error.statusCode = 413;
        error.code = "error.proto.bodyTooLarge";
        fail(error);
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (settled) return;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const body: RequestBody = raw ? JSON.parse(raw) : {};
        settled = true;
        resolve(body);
      } catch (caught) { const e = caught as CodedError;
        const error: CodedError = new Error(`invalid JSON body: ${e.message}`);
        error.statusCode = 400;
        error.code = "error.proto.invalidJson";
        fail(error);
      }
    });
    req.on("error", fail);
  });
}

/** Parse a bare `host[:port]` authority as a URL; return undefined for invalid forms. */
function parseAuthority(authority: string) {
  try {
    return new URL(`http://${authority}`);
  } catch {
    return undefined;
  }
}

/**
 * Return the normalized authority form. Parse with both http and https to preserve explicit :80 and :443,
 * preventing WHATWG URL from stripping default ports and unintentionally granting access on any port.
 */
function canonicalAuthority(authority: string, parsed: URL) {
  const port = parsed.port !== "" ? parsed.port : new URL(`https://${authority}`).port;
  return port === "" ? parsed.hostname : `${parsed.hostname}:${port}`;
}

/** Accept only clean, normalized `host[:port]`; reject paths, userinfo, whitespace, and non-canonical ports. */
function isCanonicalAuthority(authority: string, parsed: URL) {
  return canonicalAuthority(authority, parsed) === authority.toLowerCase();
}

/** Match the DSH `/api` trust boundary: localhost, IPv6 loopback, or IPv4 127/8. */
function isLoopbackHostname(hostname: string) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** A trustedHosts entry with a port must match exactly; one without a port matches any port on that host. */
function isTrustedAuthority(hostUrl: URL, trustedHosts: string[]) {
  return trustedHosts.some((entry) => {
    if (typeof entry !== "string") return false;
    const entryUrl = parseAuthority(entry);
    if (!entryUrl || !isCanonicalAuthority(entry, entryUrl)) return false;
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host;
  });
}

/**
 * Reuse `trustedHosts` from the DSH Web runtime (LAN IPs + `--trusted-host`) while
 * retaining the loopback default; continue rejecting unknown Hosts, cross-site Fetch, and cross-origin requests.
 */
function validateRequestOrigin(req: IncomingMessage, trustedHosts: string[] = []) {
  const host = typeof req.headers.host === "string" ? req.headers.host : "";
  const hostUrl = parseAuthority(host);
  if (!hostUrl || !isCanonicalAuthority(host, hostUrl)) {
    return { statusCode: 403, code: "error.proto.forbiddenHost", error: "forbidden host" };
  }
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) {
    return { statusCode: 403, code: "error.proto.forbiddenHost", error: "forbidden host" };
  }
  if (req.headers["sec-fetch-site"] === "cross-site") {
    return { statusCode: 403, code: "error.proto.forbiddenHost", error: "forbidden host" };
  }
  const origin = req.headers.origin;
  if (typeof origin === "string") {
    try {
      if (new URL(origin).host !== hostUrl.host) {
        return { statusCode: 403, code: "error.proto.forbiddenHost", error: "forbidden host" };
      }
    } catch {
      return { statusCode: 403, code: "error.proto.forbiddenHost", error: "forbidden host" };
    }
  }
  return null;
}

/** Write endpoints additionally require a custom header and JSON; the header forces cross-site Fetch preflight, and this endpoint does not return CORS headers. */
function validateMutationRequest(req: IncomingMessage, trustedHosts: string[]) {
  const hostError = validateRequestOrigin(req, trustedHosts);
  if (hostError) return hostError;
  if (req.headers[CLIENT_MARKER_HEADER] !== "1") return { statusCode: 403, code: "error.proto.forbidden", error: "forbidden mutation request" };
  const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return { statusCode: 415, code: "error.proto.contentType", error: "content-type must be application/json" };
  return null;
}

function json(res: ServerResponse, code: number, payload: unknown, headOnly = false) {
  if (!res || res.writableEnded || res.destroyed) return;
  res.once("error", () => {});
  try {
    const body = JSON.stringify(payload);
    res.writeHead(code, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    // Per RFC semantics, HEAD returns the content-length of the corresponding entity without a body.
    res.end(headOnly ? undefined : body);
  } catch {
    /* Client disconnected. */
  }
}

/** Wrap successes as `{ ok: true, data }`; pass through core `{ ok: false, error }` results as 400 responses. */
function run(res: ServerResponse, task: () => unknown, afterSuccess?: () => void, headOnly = false) {
  return Promise.resolve().then(task).then((r) => {
    if (r && typeof r === "object" && "ok" in r && r.ok === false) json(res, 400, r, headOnly);
    else {
      try {
        if (afterSuccess) afterSuccess();
      } catch {
        /* Directory refresh failure does not affect completed file operations. */
      }
      json(res, 200, { ok: true, data: r }, headOnly);
    }
  }).catch((e) => {
    try {
      json(res, Number.isInteger(e && e.statusCode) ? e.statusCode! : 500, {
        ok: false,
        ...(e && e.code ? { code: e.code } : {}),
        error: String(e && e.message ? e.message : e),
      }, headOnly);
    } catch {
      /* response already closed */
    }
  });
}

/** Refresh the host skill directory after file writes and notify Web to reload the `/` menu cache. */
function notifyChatCatalog(ctx: HostContext, invalidateSkills?: () => void) {
  try {
    if (typeof invalidateSkills === "function") invalidateSkills();
  } catch {
    /* Directory cache invalidation failure does not affect completed file operations. */
  }
  try {
    if (typeof ctx.emit === "function") ctx.emit("commands/change");
  } catch {
    /* Command directory refresh failure does not affect completed file operations. */
  }
  try {
    const sessions = typeof ctx.get === "function" ? ctx.get("sessions") : undefined;
    const list = sessions && typeof sessions.list === "function" ? sessions.list() : [];
    for (const session of list) {
      const id = session && (session.id ?? session.header?.id);
      const preset = session && session.header && typeof session.header.agentPreset === "string"
        ? session.header.agentPreset
        : undefined;
      if (id == null || !preset || typeof ctx.emit !== "function") continue;
      // The Web `/` skill menu is cached in dsh-client-ui-skill and invalidated only on agent-preset/selected;
      // skills/change is not in the official forwarding allowlist, so reuse this forwarded event.
      ctx.emit("agent-preset/selected", id, preset);
    }
  } catch {
    /* Slash-menu refresh failure does not affect completed file operations. */
  }
}

/** Resolve the working directory only from the known Session currently selected by the client; do not fall back to another session if it is missing or invalid. */
function activeSessionCwds(ctx: HostContext, sessionId: unknown) {
  if (typeof sessionId !== "string" || !sessionId.trim()) return [];
  const sessions = ctx.sessions || (typeof ctx.get === "function" ? ctx.get("sessions") : undefined);
  if (!sessions) return [];
  const session = typeof sessions.get === "function" ? sessions.get(sessionId) :
    (typeof sessions.list === "function" ? sessions.list() : []).find((item) => (item.id ?? item.header?.id) === sessionId);
  const cwd = session?.header?.cwd;
  return typeof cwd === "string" && cwd.trim() ? [cwd.trim()] : [];
}

function externalSkillProvider(control: ProviderControl, invalidators: Set<() => void>) {
  invalidators.add(control.invalidate);
  if (control.signal && typeof control.signal.addEventListener === "function") {
    control.signal.addEventListener("abort", () => {
      invalidators.delete(control.invalidate);
    }, { once: true });
  }
  return {
    name: "dsh-skills-manager-external",
    list: async (options?: ScopeOptions) => listProviderCandidates(options),
    get: async (candidate: ProviderCandidate, options?: ScopeOptions) => getProviderSkill(candidate, options),
  };
}

/**
 * Agent presets register their filesystem provider in a nearer, preset-scoped
 * skill layer. Register the manager policy once more in each live agent's own
 * layer so disabled shared skills cannot fall through to that native provider.
 */
function registerAgentSkillProviders(ctx: HostContext, invalidators: Set<() => void>) {
  if (typeof ctx.on !== "function") return () => {};
  const registrations = new Map<string, () => void>();

  const install = (agent: Agent) => {
    if (!agent || registrations.has(agent.id)) return;
    const agentCtx = agent.ctx;
    const skills = agentCtx && typeof agentCtx.get === "function"
      ? agentCtx.get("skills")
      : agentCtx && agentCtx.skills;
    if (!skills || typeof skills.registerProvider !== "function") return;
    const dispose = skills.registerProvider((control) => externalSkillProvider(control, invalidators));
    registrations.set(agent.id, dispose);
  };

  const uninstall = (agent: Agent) => {
    if (!agent) return;
    const dispose = registrations.get(agent.id);
    registrations.delete(agent.id);
    if (typeof dispose === "function") dispose();
  };

  const stopCreated = ctx.on("agent/created", ({ agent }) => install(agent));
  const stopDisposed = ctx.on("agent/disposed", ({ agent }) => uninstall(agent));
  const agents = typeof ctx.get === "function" ? ctx.get("agents") : undefined;
  if (agents && typeof agents.list === "function") {
    for (const agent of agents.list()) install(agent);
  }

  return () => {
    if (typeof stopCreated === "function") stopCreated();
    if (typeof stopDisposed === "function") stopDisposed();
    for (const dispose of registrations.values()) {
      if (typeof dispose === "function") dispose();
    }
    registrations.clear();
  };
}

function apply(ctx: HostContext) {
  ctx.effect(() => registerPluginUpdater(ctx, {
    endpoint: "/api/michengai/dsh-skills-manager/update",
    packageName: "@michengai/dsh-skills-manager",
    manifestUrl: new URL("../package.json", import.meta.url),
  }), "skills-manager: plugin updater");
  const log = makeLog();
  const repositories = createRepositoryManager({ log });
  const trustedHosts = Array.isArray(ctx.webRuntime.trustedHosts) ? ctx.webRuntime.trustedHosts : [];
  const roots = userRoots();
  const rootByKey = Object.fromEntries(roots.map((r) => [r.key, r]));

  const providerInvalidators = new Set<() => void>();
  const invalidateSkills = () => {
    for (const invalidate of providerInvalidators) invalidate();
  };
  const afterWrite = () => notifyChatCatalog(ctx, invalidateSkills);
  let mutationQueue: Promise<unknown> = Promise.resolve();
  const enqueueMutation: Serialize = (task) => {
    const queued = mutationQueue.then(task, task);
    mutationQueue = queued.catch(() => undefined);
    return queued;
  };
  ctx.effect(() => ctx.skills.registerProvider((control) => externalSkillProvider(control, providerInvalidators)), "skills-manager global external skills provider");
  ctx.effect(() => registerAgentSkillProviders(ctx, providerInvalidators), "skills-manager agent-scoped external skills providers");

  if (ctx.tools && typeof ctx.tools.register === "function") {
    ctx.effect(() => ctx.tools!.register({
      name: "create_skill",
      description: "Create a new local DSH skill in DSH_HOME/skills. Use only when the user explicitly asks to create or save a reusable skill.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Skill name; it will be normalized to kebab-case." },
          description: { type: "string", description: "A concise routing description for when to use the skill." },
          body: { type: "string", description: "Markdown instructions that form the skill body." },
        },
        required: ["name", "description", "body"],
        additionalProperties: false,
      },
      output: {
        schema: { type: "object" },
        render: (_args, value) => [{ type: "text", text: value && value.ok === false ? `Skill creation failed: ${value.error}` : `Created DSH skill ${value.name} at ${value.path}` }],
      },
      async execute(args) {
        return enqueueMutation(async () => {
          const result = await createSkill(args, log);
          if (!result || result.ok !== false) afterWrite();
          return result;
        });
      },
      presentCall(args) {
        return { card: "generic", title: "Create DSH skill", kind: "edit", rawInput: args && args.name ? String(args.name) : undefined };
      },
    }), "skills-manager create_skill tool");
    if (typeof ctx.on === "function") ctx.on("tools/pre-execute", (exec, next) => {
      if (exec && exec.name === "create_skill") return Promise.resolve({ kind: "ask", reason: "Create a new skill under DSH_HOME/skills" });
      return next();
    });
  }

  // Cordis can construct a plain function apply(), so its returned disposer
  // is not collected. Own the route explicitly for restart and startup failure.
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/api/dsh-skills-manager",
    handler: async (req, res) => {
      const u = new URL(req.url!, "http://localhost");
      const path = u.pathname.replace(/\/+$/, "");
      const sessionId = req.headers["x-dsh-skills-session"];
      const projectOptions = () => ({ projectCwds: activeSessionCwds(ctx, sessionId) });
      const requestRoot = async (key: string) => rootByKey[key] || (await projectRoots(projectOptions().projectCwds)).find((root) => root.key === key);
      const stateWithSources = async () => {
        const snapshot = await state(projectOptions());
        try {
          const sources = await repositories.sources();
          for (const root of snapshot.roots) if (root.key === "dsh") for (const skill of root.skills || []) skill.installSource = sources[skill.name] || null;
        } catch (caught) { const error = caught as CodedError; snapshot.warnings.push({ code: "error.repo.state", error: error.message }); }
        return snapshot;
      };
      try {
        const connection = ctx.get?.("connection") as { requestRejection(request: IncomingMessage): 401 | 403 | undefined } | undefined;
        const rejection = connection?.requestRejection(req) ?? (connection ? undefined : 503);
        if (rejection !== undefined) {
          json(res, rejection, { ok: false, code: "error.proto.forbidden", error: "Authenticated application access required" });
          return;
        }
        const hostError = validateRequestOrigin(req, trustedHosts);
        if (hostError) {
          json(res, hostError.statusCode, { ok: false, code: hostError.code, error: hostError.error });
          return;
        }
        if (req.method === "GET" && path === "/api/dsh-skills-manager/state") {
          return run(res, stateWithSources);
        }
        if ((req.method === "GET" || req.method === "HEAD") && path === "/api/dsh-skills-manager/repositories") {
          return run(res, () => repositories.list(), undefined, req.method === "HEAD");
        }
        if (req.method === "HEAD") {
          // HEAD reuses the GET/405 payload to calculate content-length and preserve response-header semantics consistent with the entity.
          if (path === "/api/dsh-skills-manager/state") return run(res, stateWithSources, undefined, true);
          json(res, 405, { ok: false, code: "error.proto.method", error: `method not allowed: ${req.method}` }, true);
          return;
        }
        if (req.method !== "POST") {
          json(res, 405, { ok: false, code: "error.proto.method", error: `method not allowed: ${req.method}` });
          return;
        }
        const requestError = validateMutationRequest(req, trustedHosts);
        if (requestError) {
          json(res, requestError.statusCode, { ok: false, code: requestError.code, error: requestError.error });
          return;
        }
        const body = await readBody(req, path === "/api/dsh-skills-manager/upload" ? MAX_UPLOAD_BODY_BYTES : undefined);
        if (path.startsWith("/api/dsh-skills-manager/repositories/") && (!body || typeof body !== "object" || Array.isArray(body))) {
          json(res, 400, { ok: false, code: "error.repo.invalid", error: "Repository parameters must be an object" });
          return;
        }
        if (path === "/api/dsh-skills-manager/browse") {
          return run(res, () => browseDirectories(body.path));
        }
        // Refresh downloads modify only the repository directory cache and use its own serial queue, avoiding interference with local enable/disable and imports.
        if (path === "/api/dsh-skills-manager/repositories/refresh") return run(res, () => repositories.refresh(body));
        return enqueueMutation(() => {
          switch (path) {
            case "/api/dsh-skills-manager/repositories/add":
              return run(res, () => repositories.add(body));
            case "/api/dsh-skills-manager/repositories/remove":
              return run(res, () => repositories.remove(body));
            case "/api/dsh-skills-manager/repositories/detail":
              return run(res, () => repositories.detail(body));
            case "/api/dsh-skills-manager/repositories/install":
              return run(res, () => repositories.install(body), afterWrite);
            case "/api/dsh-skills-manager/repositories/preview":
              return run(res, () => repositories.preview(body));
            case "/api/dsh-skills-manager/repositories/update":
              return run(res, () => repositories.update(body), afterWrite);
            case "/api/dsh-skills-manager/repositories/rollback":
              return run(res, () => repositories.rollback(body), afterWrite);
            case "/api/dsh-skills-manager/enable":
              return run(res, async () => setSkillEnabled(await requestRoot(String(body.root || "dsh")), String(body.name || ""), true, log), afterWrite);
            case "/api/dsh-skills-manager/disable":
              return run(res, async () => setSkillEnabled(await requestRoot(String(body.root || "dsh")), String(body.name || ""), false, log), afterWrite);
            case "/api/dsh-skills-manager/source-enable":
              return run(res, () => setSourceEnabled(String(body.root || ""), true, log, projectOptions()), afterWrite);
            case "/api/dsh-skills-manager/source-disable":
              return run(res, () => setSourceEnabled(String(body.root || ""), false, log, projectOptions()), afterWrite);
            case "/api/dsh-skills-manager/delete":
              return run(res, async () => deleteSkill(await requestRoot(String(body.root || "dsh")), String(body.name || ""), log), afterWrite);
            case "/api/dsh-skills-manager/trash-restore":
              return run(res, () => restoreTrash(String(body.id || ""), log, projectOptions()), afterWrite);
            case "/api/dsh-skills-manager/trash-delete":
              return run(res, () => permanentlyDeleteTrash(String(body.id || ""), log));
            case "/api/dsh-skills-manager/detail":
              return run(res, () => skillDetail(String(body.root || "dsh"), String(body.name || ""), projectOptions()));
            case "/api/dsh-skills-manager/create":
              return run(res, async () => createSkill(
                { name: body.name, description: body.description, body: body.body },
                log,
                { root: await requestRoot(String(body.root || "dsh")) },
              ), afterWrite);
            case "/api/dsh-skills-manager/import":
              return run(res, () => importSkill(String(body.source || ""), log, {
                conflict: body.conflict === "overwrite" ? "overwrite" : "skip",
                dryRun: body.dryRun === true,
              }), body.dryRun === true ? undefined : afterWrite);
            case "/api/dsh-skills-manager/upload":
              return run(res, () => importUploadedSkill({ name: body.name, entries: body.entries, zip: body.zip }, log, {
                conflict: body.conflict === "overwrite" ? "overwrite" : "skip",
              }), afterWrite);
            default:
              json(res, 404, { ok: false, code: "error.proto.unknownAction", error: `unknown action: ${path}` });
          }
        });
      } catch (caught) { const e = caught as CodedError;
        json(res, Number.isInteger(e && e.statusCode) ? e.statusCode! : 500, {
          ok: false,
          ...(e && e.code ? { code: e.code } : {}),
          error: String(e && e.message ? e.message : e),
        });
      }
    },
  }), "skills-manager: API route");
}

export { activeSessionCwds, apply, inject, name, notifyChatCatalog, registerAgentSkillProviders };

/** Request bodies are parsed and validated by the existing business entry points; this type declares only the fields passed through by the route. */
type RequestBody = CreateInput & UploadInput & SkillRequest & RepositoryInput & {root?: string; source?: string; conflict?: string; dryRun?: boolean};
