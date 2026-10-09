# Changelog

[English](CHANGELOG.md)

## Unreleased

## 1.1.10 - 2026-10-06

- The installed-plugin list displays “Skills Manager” and its localized description instead of only the package name. The display name and description come from `meta.title` and `meta.description` in `locale/zh.json` and `locale/en.json`.
- GitHub installations now include the compiled runtime files, so no manual build is needed.

## 1.1.9 - 2026-10-04

- Fix a stale `/api/dsh-skills-manager` route after plugin unload or reactivation, which could cause startup to fail with `duplicate prefix route` and make the Skills settings panel unavailable (#25). The route is now explicitly managed by a Cordis effect and is released correctly on restart and startup failure.

## 1.1.8 - 2026-09-30

- Recognize WorkBuddy skill directories `~/.workbuddy/skills` and `<project>/.workbuddy/skills`.
- Recognize Qoder (`~/.qoder/skills`, `<project>/.qoder/skills`), Qoder CN CLI (`~/.qoder-cn/skills`), and Qoder CN IDE (`~/.lingma/skills`, `<project>/.lingma/skills`). Qoder CN CLI project skills use the shared Qoder project directory.

## 1.1.7 - 2026-09-30

- Installing a skill from a repository now writes the same enable policy as manually enabling it. The skill is immediately available from the slash menu without toggling it off and on again, including when the host YAML parser rejects the description.

## 1.1.6 - 2026-09-30

This release supports DeepSeek Harness `0.2.0-rc.2`. Previously supported versions remain available.

## 1.1.5 - 2026-09-28

This release supports DeepSeek Harness `0.2.0-rc.1`. Previously supported versions remain available.

## 1.1.4 - 2026-09-25

This release supports DeepSeek Harness `0.1.7-rc.2`. Previously supported versions remain available.

## 1.1.3 - 2026-09-24

This release adds support for `0.1.7-rc.1`. Versions `1.1.1` and `1.1.2` were tagged but not published to npm.

- Compatibility installation pins plugins to the host's Cordis version so older rc hosts can start during release validation.
- The compatibility statement in the README now matches the package version.

## 1.1.2 - 2026-09-24

This release publishes the `0.1.7-rc.1` support from 1.1.1. That tag was not published to npm: older rc hosts pin Cordis to `4.0.2`, which newer Cordis plugins no longer accept, so the host exited before the compatibility check could connect.

- Compatibility installation now pins `cordis-plugin-group`, `cordis-plugin-hmr`, `cordis-plugin-include`, `cordis-plugin-loader`, and `cordis-plugin-timer` to the corresponding host Cordis version.
- Supported hosts remain `0.1.0-rc.8`, `0.1.1-rc.2`, `0.1.2-rc.1`, `0.1.5-rc.1`, `0.1.5-rc.2`, and `0.1.7-rc.1`.

## 1.1.1 - 2026-09-24

This release supports DeepSeek Harness `0.1.7-rc.1` and no longer accepts alpha host versions.

- Supported hosts are `0.1.0-rc.8`, `0.1.1-rc.2`, `0.1.2-rc.1`, `0.1.5-rc.1`, `0.1.5-rc.2`, and `0.1.7-rc.1`.
- `0.1.6-alpha.1`, `0.1.6-alpha.2`, and `0.1.7-alpha.1` are no longer in the compatibility range.

## 1.1.0 - 2026-09-23

This release rebuilds the **Settings → Skills** page and supports DeepSeek Harness `0.1.7-alpha.1`, while retaining support for the seven preceding versions.

- The page follows the host's light or dark theme, with familiar blue controls.
- Refresh, create, and import actions now use round buttons. GitHub, feedback, and check-for-updates actions remain compact and retain their icons.
- Source and status filters use compact dropdowns, with search to their right on the same row. Pressing Escape closes an open filter or More menu without closing the Settings page.
- Skills are grouped by source and can be collapsed. Hover over a name to see its description. Details show the same fields as repository details: name, description, path, and read-only body.
- The switch is at the far right of each row. “Enabled” and “Disabled” labels have been removed; shadowing and diagnostic issues are still indicated.
- The update dialog is no longer centered. Status appears next to the latest version, and manual commands can wrap onto multiple lines. Pressing Escape closes only this dialog.

## 1.0.1 - 2026-09-21

This maintenance release improves source development, package validation, and screenshot privacy while preserving the existing plugin runtime interfaces.

### Development and packaging

- Migrated ten source modules to strict TypeScript while preserving the plugin architecture and JavaScript runtime entry point. Added domain, host, and client contracts, positive and negative type tests, and type checking to the main test command.
- `lib` is no longer tracked by Git. Packaging checks types and builds automatically; validation confirms that a clean checkout without `lib` can still produce a package containing all runtime files and a loadable server entry point.
- CI covers the exact minimum Node.js 22.19.0 as well as Node.js 24. Source changes also trigger the supported-host compatibility matrix.
- Clarified support for npm registry and locally built `.tgz` installations; direct Git/GitHub dependency installation is unsupported. Chinese and English development documentation is aligned.

### Fixes

- Fix focus loss when an asynchronous form submission disables its button. After an error, Escape now closes only the plugin dialog rather than also closing the host Settings page.

### Documentation and privacy

- Cropped all nine screenshots to their feature panels, obscured local paths, and removed real filenames and project directories from the background. Lossless compression reduced the total size by 81%.
- Corrected the English screenshot description and updated the documentation layout to match the cropped dimensions.

## 1.0.0 - 2026-09-21

### 1.0 stable release scope

This release upgrades directly from the published 0.1.53 to 1.0.0. The planned 0.1.54 was not released separately; its changes are included here. The plugin enters the 1.x series. Host compatibility remains limited to the explicitly listed versions and does not imply support for every future DSH release.

### Added: skill repositories and installation

- Added a **Skill repositories** tab alongside Global, Project, and Trash, with options to add, manage, and remove subscriptions to public GitHub repositories.
- Accepts owner/repo names, HTTPS repository URLs, and tree URLs. A branch, tag, or skill subdirectory can be specified; leaving it blank uses the default branch.
- Repository skills are grouped by source. Search by name or description and filter by repository or installation status. Details show the skill body, path, and scan snapshot.
- Installs individual skills to global DSH while preserving descriptions, scripts, and resources. Skill scripts are not executed during installation, and skills with duplicate names are not overwritten.
- Shows installable, installed, name-conflict, invalid-format, and update-available states, with inline progress and success or failure feedback during installation.
- Global skills distinguish local installs from repository sources and provide GitHub source links. Update management can locate the corresponding repository skill.
- Removing a repository only cancels the subscription; installed skills and their source-tracking records are retained.

### Added: online updates and backup recovery

- Combined **Refresh** and **Check for updates** into **Refresh and check for updates**. Refresh scans the cache and checks for updates without automatically replacing local copies.
- Compares content hashes for every file in the skill directory, including descriptions, scripts, and resources. Changes to unrelated repository files do not cause false update notices.
- Previews added, modified, and deleted files before an update. Backups and replacement occur only after confirmation.
- Protects local changes by default. Overwriting requires explicitly choosing **Back up local changes and replace**; if content changes after preview, it must be previewed again.
- Adds **Restore previous version**, which previews differences and backs up the current copy before restoring. Local changes in the previous version are preserved as well.
- Updates use directory replacement with rollback on failure. If state persistence fails, the original files are restored. Historical backups are retained and not automatically cleaned up.

### Downloads and reliability

- Downloads ZIP archives directly from codeload.github.com without consuming the anonymous GitHub REST quota. If no branch is specified, tries HEAD first and falls back to main/master only on 404; 403 responses and timeouts do not trigger blind branch retries.
- Uses SHA-256 content snapshots and a validated cache. Installation and updates reuse the scanned archive; a damaged or missing cache requires another refresh to avoid silently using different content.
- A scan or download failure preserves the previous list and cache. Removes duplicate list reads and file-hash calculations; downloads do not occupy the local file-modification queue.
- If files were installed but source confirmation was interrupted, reopening the list verifies the complete directory before restoring the record. Modified, missing, extra, or linked files are not automatically claimed.
- Provides clear errors for repository archives larger than 32 MiB and failed state writes. Limits extraction size, entry count, paths, and body size; validates invalid paths, duplicate paths, and damaged archives.
- Repository endpoints enforce cross-origin and write-request protections and reject path traversal. Concurrent repository operations are serialized.

### Interface and interactions

- Standardizes the layout as **Title → tabs → current-page actions → filters and list**, using host Input/Menu components and input and dropdown controls styled like the archive interface.
- Changes the skill list to a compact two-line layout, with source links, enable state, and More actions in their own positions. Filters and collapsible groups reduce the space used by long lists.
- Isolates import results by tab, so switching to the repository tab no longer shows a global-skill import completion message.
- Fixes background flicker when opening repository details: first shows a loading state in the dialog, reads only the details, and does not mark the whole page busy or reload the background list.
- Full refreshes and individual repository refreshes in the management dialog show a spinner, current repository, and item count. Animation stops on success or failure; failures can be retried, and reduced-motion preferences are respected.
- Completes Chinese and English button, error, progress, and result messages and removes obsolete copy. The empty Project state now refers to the workspace to avoid misleading users with ordinary folders.
- Uses host semantic color variables with fallbacks for older hosts that lack them; preserves keyboard navigation, menu closing, and focus restoration.

### Documentation and validation

- Rewrote the Chinese and English READMEs to explain repository installation, source tracking, update recovery, and limitations, and provided full guides for both languages.
- Updated both language banners to show DSH Skills Manager at the top; refreshed global-skill and repository screenshots, standardized on WebP, and retained original dimensions with lossless compression.
- Public documentation focuses on current product capabilities. Internal handoffs, runtime evidence, machine paths, and historical screenshots are excluded from public release materials.
- The compatibility matrix pins official host dependencies at each layer and checks the installed versions, fixing mixed transitive dependencies on prerelease hosts. Retains compatibility with seven host versions and real-browser regression checks.

### Existing capabilities retained in 1.0

The following capabilities were introduced in 0.x and remain supported; they were not all newly added in this release:

- Discover, search, inspect, diagnose, and enable or disable global and current-session project skills by skill or source. Works with ordinary workspaces and Git projects.
- Prefer project copies, control same-named copies independently, and fall back to a global copy after disabling a project copy. Enable state affects DSH invocation only and does not modify other Agents' source files.
- Read skills from DSH, Common Agents, CC Switch, Codex, Claude Code, Gemini, OpenCode, Cursor, Copilot, Windsurf, Trae, OpenClaw, Roo, CodeBuddy, and other sources.
- Create skills and import ZIP archives, folders, or `SKILL.md` files into global DSH; move DSH skills to Trash, restore them, or permanently delete them.
- Check for and update the plugin itself, with a Chinese and English interface.

### Upgrade and known limitations

- After release, update the plugin from **Settings → Skills → Check for updates** or rerun the installation command in the README, then restart DSH and refresh the page. **Refresh and check for updates** in the repository section checks skill content only and is separate from plugin updates.
- Existing skills do not need to be migrated manually. If you used the local 0.1.54 test package, back up the skills and skills-manager state directories under DSH_HOME before upgrading.
- Supports only public GitHub repositories, global DSH installation, and manually confirmed updates. Private repository credentials, automatic updates, bulk replacement, and project-level repository installation are not provided.
- Repository archives are limited to 32 MiB; selecting a subdirectory does not reduce the download size. Backups are not automatically cleaned up, and only the most recent backup has a quick-restore action. Forced termination or power loss may require manual recovery.
- Supports DSH `0.1.0-rc.8`, `0.1.1-rc.2`, `0.1.2-rc.1`, `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.6-alpha.1`, and `0.1.6-alpha.2`. Requires Node.js `^22.19.0` or `>=24.0.0`.

## 0.1.53 - 2026-09-18

- Fix the empty Project tab on official DeepSeek Harness `0.1.6-alpha.2`: the session list no longer provides the current-session field, so the Project tab now follows the session being viewed in the main interface. Older hosts continue using the previous current-session behavior.
- Add compatibility with DeepSeek Harness `0.1.6-alpha.2`, retaining support for the six earlier versions.
- Make the `package.json` description bilingual to match the GitHub repository description.

## 0.1.52 - 2026-09-16

- Add compatibility with DeepSeek Harness `0.1.6-alpha.1`, retaining support for the five earlier versions. Skill discovery, enable/disable, and management remain unchanged.
- Normalize isolated host sandbox paths to prevent Windows 8.3 temporary paths from causing CI project-skill path comparisons to fail.

## 0.1.51 - 2026-09-16

- Add compatibility with DeepSeek Harness `0.1.6-alpha.1`, retaining support for the five earlier versions. Skill discovery, enable/disable, and management remain unchanged.

## 0.1.50 - 2026-09-12

- Fix project skills being skipped in non-Git workspaces. When there is no `.git` ancestor, the current session's working directory is used as the project root, so project skills can be viewed and enabled without running `git init`.

## 0.1.49 - 2026-09-12

- Add Copilot support for global `~/.copilot/skills` and project `.github/skills`, expanding project sources for common Agents. The Project tab follows only the current session; direct project-management API calls must include the session ID in `x-dsh-skills-session`.
- Project copies take priority over global copies, and each source can be enabled or disabled independently. Another enabled copy can take over when one is disabled, with the active source shown in the interface; invocation is blocked only when all copies are disabled.
- Give Global, Project, and Trash separate tabs. Group skills by collapsible source, hide long descriptions, and remove redundant information. Creation and import always save to global DSH; generic project `skills/` directories use a neutral source name.
- Fix update buttons and dialogs not following Chinese/English language changes, and align Trash date formatting and import-warning separators with the selected language.
