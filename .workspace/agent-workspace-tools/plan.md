# Workspace tools implementation plan

Goal: agents can use existing workspace features and research captures itself.
Architecture: register tools as a child of the workspace controller, delegating to existing owners; capture successful retrievals in the tool pipeline; refresh panels from session activity.

1. Add regression tests through ToolRuntime for automatic capture, project isolation, source storage restart, feature tool availability and policy. Run red.
2. Implement immutable virtual source capture and source tools, automatic capture receipts and prompt context. Run green.
3. Expose journal/writing/analysis, review/comments/citations, handoffs, app inspection, workspace management and recovery drafts using existing validation. Test revision conflicts, policy and sensitive-action intent.
4. Update Research/Writing/Analysis data after agent results without losing selection/drafts. Run client regressions.
5. Audit shipped feature-to-tool parity, build host/client/runtime, run focused integration checks and independent review. Install local update if packaging is supported and verify separately.

Constraints: keep unrelated work intact, no provider credentials in artifacts, no new session formats, no app-audience bypass, notebook outcome remains job-owned, no network publication.
