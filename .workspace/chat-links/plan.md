# Private chat links and Workbench release

Goal: copy a private chat link, reference it from any model in another local chat, and open it in the installed app. Release the selected Workbench UI, motion and graphics alongside this feature.

Use dsh://sessions/<encoded-session-id> and the existing completed-history session reference resolver. Preserve the canonical dsh-session encoding and archived historical snapshots. Links identify sessions within the current profile; they publish no conversation data. Missing sessions must report an error without creating a session. Native launches queue the selected chat until authenticated client metadata is ready; later manual navigation cancels a pending open.

1. Pin URI parsing, pasted-reference preparation, clipboard feedback and queued native navigation with tests.
2. Add shared URI helpers, a Copy chat link menu action and origin-scoped Desktop delivery. Reuse existing bounded untrusted reference context for every provider.
3. Transfer the approved Workbench source changes from their recorded baseline and verify shell, terminal, chart and diagram behavior in the release checkout.
4. Verify a real copied-link-to-model flow, native launch/navigation and unchanged source-session data. Qualify and publish matching Linux and Windows packages, update the download page and verify public hashes.
