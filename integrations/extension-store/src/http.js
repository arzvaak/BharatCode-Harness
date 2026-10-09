/** Custom HTTP routes follow the host's loopback and browser-origin boundary. */
export function trustedRequest(req) {
  const remote = req.socket?.remoteAddress;
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote);
  if (!local || req.headers["sec-fetch-site"] === "cross-site") return false;
  let host;
  try {
    host = new URL(`http://${req.headers.host}`);
  } catch {
    return false;
  }
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(host.hostname) ||
    host.username ||
    host.password ||
    host.pathname !== "/" ||
    host.search ||
    host.hash
  )
    return false;
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      return (
        ["http:", "https:"].includes(origin.protocol) &&
        origin.host === host.host
      );
    } catch {
      return false;
    }
  }
  return (
    req.headers["sec-fetch-site"] === "same-origin" ||
    String(req.headers.cookie ?? "")
      .split(";")
      .some((x) => /^dsh-auth-[^=]+=.+/.test(x.trim()))
  );
}
export function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
export async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? ""))
    throw Error("JSON request required");
  let size = 0;
  const chunks = [];
  for await (const x of req) {
    size += x.length;
    if (size > 65536) throw Error("Request too large");
    chunks.push(x);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString());
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid action");
  return value;
}
