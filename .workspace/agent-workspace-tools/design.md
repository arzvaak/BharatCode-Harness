# Agent access to workspace features

User request: automatically retain research sources and implement missing model tools for all existing workspace features.

Reuse host service owners and their validation, revisions, jobs and tool policy. Add project_sources, workspace_records, workspace_review, workspace_handoff, workspace_apps, workspace_manage and workspace_drafts. Resolve project/session from trusted execution metadata. Never accept arbitrary session identity for private drafts or bypass app-only tool restrictions. Require explicit human authorization for handoff dispatch, paid replay and project/session management mutations. Existing plugins/skills/jobs/goals/terminal/files tools remain authoritative.

Automatic source capture: successful web_fetch and web_search store the exact returned evidence and URL/provenance in immutable private project storage, with complete versus excerpt labels. Successful reads/writes/edits under sources/ register complete project files, as do updates to already registered documents. Deduplicate captures, never register failed retrievals, keep original read/write success when capture fails but return a visible failure receipt. Source text is untrusted evidence, never instructions. Source tool can register existing files in bulk or retain explicit excerpts. Captured virtual sources use the existing generatedBy field and captured status; no persisted shape change.

UI reads stay project scoped and update during/after agent activity. Preserve selection and unsaved writing drafts. Models see workspace instructions, current project and workflow at every prompt assembly.

Verification: real tool registry → real project knowledge storage → retrieval/reopen, default provider reads → automatic capture, failures/dedup/revisions/project isolation, policy denial, feature action parity and UI invalidation. Installed desktop update is a separate verified step after source and built runtime checks; no release publication requested.
