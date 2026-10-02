# Upstream compatibility implementation plan

English | [中文](2026-10-02-upstream-compatibility.zh.md)

**Goal:** Integrate upstream through reviewed candidate PRs with Linux, Windows and web evidence while preserving the independent rebranding worktree.

**Architecture:** A committed accepted-upstream record and behavior register drive drift reports. A GitHub App prepares one merge-forward candidate PR. Deterministic built-profile tests and platform workflows contribute to a required aggregate check; release candidates retain immutable evidence and artifacts.

**Tasks**

- [ ] Add accepted-baseline metadata, behavior register, drift/candidate helpers, and temporary-repository regression tests.
- [ ] Add sanitized desktop composition and built runtime activation/search/model checks, auto-continuation behavior tests, and negative controls.
- [ ] Extend CI with full unit/replay/expected/web/Linux desktop/Windows packaging checks and immutable evidence. Add explicit live-provider and release-candidate verification.
- [ ] Add daily GitHub App candidate automation, migration validation, operating instructions, and enforce reviewed protected merges.
- [ ] Validate locally, publish a review PR, inspect hosted results, and document unresolved external setup without claiming it passed.

**Constraints:** No secrets or personal profiles in fixtures; no test deletion, automatic snapshot rewriting, broad exclusions, auto-merges, or rebranding changes. Native Windows uses pwsh. Missing credentials fail explicitly. An upstream conflict stops integration and reports affected behaviors.

**Verification:** Negative controls reject invalid config targets, disabled required plugins, incorrect provider selection, continuation failures and missing runtime dependencies. Test candidate preparation using temporary Git repositories, including repeat runs and conflicts. Run focused local tests/build; hosted CI owns exhaustive/platform suites.
