# BC CI pipelines

This optional native bundle reads GitHub Actions runs, jobs and bounded job logs, and GitLab.com pipelines, jobs and traces. It reuses the credential service through `GITHUB_TOKEN` and `GITLAB_TOKEN`; tokens never appear in configuration or tool results. Accounts need repository Actions or project CI access. Self-hosted GitLab routes remain unqualified.

`pipeline_rerun` is disabled by default. Enabling `allowRerun` permits the native approval path to ask before retrying failed remote jobs. It never turns log content into authorization. Investigation tools return evidence for diagnosis and workspace fixes; they do not commit or publish fixes automatically.

The bundle executes with host privileges and activates profile-wide. Test fixtures prove route selection, response bounds and credential redirect handling. Real-account and native Windows qualification remain required before the store enables installation.

API contracts: [GitHub workflow runs](https://docs.github.com/en/rest/actions/workflow-runs), [GitLab pipelines](https://docs.gitlab.com/api/pipelines/), and [GitLab jobs](https://docs.gitlab.com/api/jobs/).
