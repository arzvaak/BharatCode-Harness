const REPOSITORY = "arzvaak/BharatCode-Extensions";
const ASSET_HOSTS = new Set([
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);
async function bounded(response, maxBytes) {
  if (Number(response.headers.get("content-length")) > maxBytes)
    throw Error("Download too large");
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw Error("Download too large");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export class GithubTransport {
  constructor(resolveToken, fetcher = fetch) {
    this.resolveToken = resolveToken;
    this.fetcher = fetcher;
  }
  async request(
    path,
    {
      maxBytes = 4 * 1024 * 1024,
      signal,
      accept = "application/vnd.github+json",
    } = {},
  ) {
    if (
      !/^\/(?:releases(?:\/tags\/[A-Za-z0-9._-]+|\/assets\/[0-9]+)?)$/.test(
        path,
      )
    )
      throw Error("Invalid GitHub path");
    const token = await this.resolveToken();
    const timeout = AbortSignal.timeout(60000);
    const cancel = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let url = `https://api.github.com/repos/${REPOSITORY}${path}`;
    let headers = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await this.fetcher(url, {
        headers,
        redirect: "manual",
        signal: cancel,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        let next;
        try {
          next = new URL(location);
        } catch {
          throw Error("Unsafe GitHub asset redirect");
        }
        if (
          !ASSET_HOSTS.has(next.hostname) ||
          next.protocol !== "https:" ||
          next.username ||
          next.password ||
          next.port ||
          next.hash
        )
          throw Error("Unsafe GitHub asset redirect");
        url = next.href;
        headers = { Accept: "application/octet-stream" };
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403, 404].includes(response.status))
          throw Error(
            "Extension download access denied or release unavailable",
          );
        throw Error(`GitHub request failed (${response.status})`);
      }
      return bounded(response, maxBytes);
    }
    throw Error("Too many GitHub redirects");
  }
  async asset(id, options = {}) {
    if (!Number.isSafeInteger(id) || id < 1) throw Error("Invalid asset ID");
    return this.request(`/releases/assets/${id}`, {
      ...options,
      accept: "application/octet-stream",
    });
  }
  async release(tag, options) {
    return JSON.parse(
      (await this.request(`/releases/tags/${tag}`, options)).toString("utf8"),
    );
  }
}
