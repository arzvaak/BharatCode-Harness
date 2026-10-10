---
kind: upgrade-guide
description: "Desktop release artifacts and the visible application name use BharatCode while existing data roots and technical package identifiers remain stable."
---
# BharatCode application identity

English | [中文](guide.zh.md)

## Change

The sidebar, onboarding, application icons, browser title, and desktop menus use BharatCode. Desktop release filenames start with `bharatcode-` instead of `deepseek-harness-`. The shipped browser composition exposes integration configuration in Settings and omits the package-installation page and agent installation tools. Internal plugin loading and developer packaging remain available.

## Migration

1. Keep the existing Harness home, profiles, credentials, and session files in place. Cosmetic branding does not migrate or delete them.
2. For a fresh BharatCode release, configure `DSH_DESKTOP_APP_ID=io.arzvaak.bharatcode` consistently across packaging targets. Existing distributors retain their registered application identity when producing an in-place upgrade.
3. Update artifact-name filters to accept `bharatcode-*.exe` or the corresponding platform suffix. Technical npm package identifiers and the `dsh` launcher stay compatible.
4. Open the upgraded profile and confirm that history and configured model routes remain available. Integration configuration is in Settings.
