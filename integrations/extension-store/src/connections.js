import { credentialRef } from "@deepseek-ai/dsh-credentials";
/** Explicit connection changes affect only the installed extension's owned credential. */
export async function configureConnection(
  { credentials, installed, runtime },
  request,
) {
  const record = installed.find((r) => r.id === request.id);
  const entry = record?.descriptor;
  if (
    !entry ||
    entry.kind !== "mcp" ||
    entry.status !== "qualified" ||
    entry.credentialReference !==
      `BC_EXT_${entry.id.replaceAll("-", "_").toUpperCase()}_TOKEN`
  )
    throw Error(
      "Installed qualified connector with an owned credential required",
    );
  if (runtime.hasWork(entry.id))
    throw Error("Stop connector work before changing credentials");
  const reference = credentialRef(entry.credentialReference);
  if (request.action === "connect-extension") {
    if (
      typeof request.token !== "string" ||
      !request.token.trim() ||
      request.token.length > 16384
    )
      throw Error("Enter a connector credential");
    await credentials.set(reference, request.token);
  } else if (request.action === "disconnect-extension") {
    await credentials.unset(reference);
  } else throw Error("Unknown connector operation");
}
