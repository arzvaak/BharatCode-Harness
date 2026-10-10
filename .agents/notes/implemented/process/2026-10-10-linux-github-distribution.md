# Agent Note: Linux GitHub distribution

Status: implemented

English | [中文](2026-10-10-linux-github-distribution.zh.md)

## Problem

The Linux preview provided only an AppImage with manual updates. Fedora and Debian users needed native packages, and public downloads needed an accessible marketing page while application CI remained local.

## Decision

Linux packaging emits AppImage, RPM and DEB installers with the public GitHub release updater configuration. The prerelease version includes the clean commit timestamp; release tags use `v<version>` and the `rc-linux.yml` feed. The existing update coordinator requires separate download and restart confirmation and retains checksum validation and downgrade prevention. Local qualification records exact package and feed bytes before publication.

The static marketing source lives beside the extension store. Local browser checks cover workflow tabs, keyboard navigation, install-command copying, responsive layout and invalid release metadata. Pages uploads the locally assembled site from `gh-pages`; only this public deployment workflow is authorized. Private application build and test Actions remain disabled.

## Consequences

Older AppImages need one manual installation before in-app updates become available. RPM and DEB updates can request system authorization. This change qualifies Linux x64; account-dependent provider generation and other operating systems retain their existing qualification limits. Public catalog content on the repository's main branch remains independent of the Pages branch.

## Verification

The local release runner requires package metadata and checksum verification, real AppImage checksum-failure and replacement checks in an owned temporary directory, marketing browser checks, and the existing complete local gates. Publishers reject stale source revisions and changed artifact bytes.

## Alternatives considered

Keeping manual AppImage downloads would leave both requested package formats and in-app updates incomplete. Hosted application builds would consume the user's Actions allocation and contradict the local release requirement.
