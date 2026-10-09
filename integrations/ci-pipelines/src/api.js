const SIZE = 1024 * 1024;
/** Provider logs are untrusted evidence. Requests never retry mutations or forward credentials to asset hosts. */
export class PipelineApi {
  constructor(resolveCredential, fetcher = fetch) {
    this.resolveCredential = resolveCredential;
    this.fetcher = fetcher;
  }
  async request(
    provider,
    project,
    route,
    { method = "GET", signal, text = false } = {},
  ) {
    if (
      !["github", "gitlab"].includes(provider) ||
      typeof project !== "string" ||
      !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(project) ||
      project.split("/").some((x) => x === "." || x === "..")
    )
      throw Error("Valid provider and project required");
    if (provider === "github" && project.split("/").length !== 2)
      throw Error("GitHub owner/repository required");
    const token = await this.resolveCredential(provider);
    if (!token)
      throw Error(`Connect ${provider} through native credentials first`);
    const url =
      provider === "github"
        ? `https://api.github.com/repos/${project}/actions/${route}`
        : `https://gitlab.com/api/v4/projects/${encodeURIComponent(project)}/${route}`;
    const headers =
      provider === "github"
        ? {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          }
        : { "PRIVATE-TOKEN": token };
    const cancel = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
      : AbortSignal.timeout(60000);
    let response = await this.fetcher(url, {
      method,
      headers,
      signal: cancel,
      redirect: "manual",
    });
    if (response.status === 302 && text && provider === "github") {
      await response.body?.cancel();
      const redirect = new URL(response.headers.get("location"));
      if (
        redirect.protocol !== "https:" ||
        redirect.username ||
        redirect.password ||
        redirect.port ||
        !/^productionresultssa[0-9]+\.blob\.core\.windows\.net$/.test(
          redirect.hostname,
        )
      )
        throw Error("Unapproved pipeline log redirect");
      response = await this.fetcher(redirect.href, {
        method: "GET",
        signal: cancel,
        redirect: "manual",
      });
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw Error("Unapproved provider redirect");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(
        `Pipeline API failed (${response.status}); check project access, token expiry and Actions/CI permissions`,
      );
    }
    if (Number(response.headers.get("content-length")) > SIZE) {
      await response.body?.cancel();
      throw Error("Pipeline output too large; inspect individual jobs");
    }
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    try {
      if (reader)
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > SIZE)
            throw Error("Pipeline output too large; inspect individual jobs");
          chunks.push(Buffer.from(value));
        }
    } finally {
      await reader?.cancel().catch(() => {});
    }
    const bytes = Buffer.concat(chunks);
    return text
      ? {
          text: bytes.toString(),
          source: "untrusted-pipeline-log",
          bytes: size,
        }
      : bytes.length
        ? JSON.parse(bytes.toString())
        : { accepted: true };
  }
  id(value) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw Error("Positive pipeline/job ID required");
    return value;
  }
  list(provider, project, signal) {
    return this.request(
      provider,
      project,
      provider === "github" ? "runs?per_page=30" : "pipelines?per_page=30",
      { signal },
    );
  }
  async inspect(provider, project, id, signal) {
    id = this.id(id);
    return this.request(
      provider,
      project,
      provider === "github" ? `runs/${id}` : `pipelines/${id}`,
      { signal },
    );
  }
  async jobs(provider, project, id, signal) {
    id = this.id(id);
    return this.request(
      provider,
      project,
      provider === "github"
        ? `runs/${id}/jobs?per_page=100`
        : `pipelines/${id}/jobs?per_page=100`,
      { signal },
    );
  }
  async log(provider, project, id, signal) {
    id = this.id(id);
    return this.request(
      provider,
      project,
      provider === "github" ? `jobs/${id}/logs` : `jobs/${id}/trace`,
      { signal, text: true },
    );
  }
  async rerun(provider, project, id, signal) {
    id = this.id(id);
    return this.request(
      provider,
      project,
      provider === "github"
        ? `runs/${id}/rerun-failed-jobs`
        : `pipelines/${id}/retry`,
      { signal, method: "POST" },
    );
  }
}
