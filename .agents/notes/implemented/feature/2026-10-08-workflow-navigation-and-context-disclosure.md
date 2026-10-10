# Agent Note: Workflow navigation and dismissible context disclosure

Status: implemented

English | [中文](2026-10-08-workflow-navigation-and-context-disclosure.zh.md)

## Problem

The composer context disclosure mixed workflow navigation with evidence inspection, lacked a visible close action, and exposed dependency errors as product copy. Users need to switch workspace views without changing the running task or losing an unsent message.

## Decision

The sidebar owns Chat, Coding, Research, and Writing view selection. Expanded navigation includes short descriptions; the collapsed rail keeps accessible workflow actions. A root presentation store retains the selected view per session. The conversation frame reads that same observable through the slot hook compartment, preserving one store scope and the native conversation factory across view switches.

Using context opens a portalled, viewport-clamped disclosure containing evidence and explicit refresh actions. A visible close button, Escape, and an outside pointer press dismiss it. The close button and Escape restore trigger focus. Inspection failure keeps existing evidence visible and offers a plain-language Retry action.

Original content transitions cancel on rapid view changes and respect reduced motion. Sidebar and dialog durations use the shared BharatCode tokens. Selection remains presentation state and does not submit a prompt, alter permissions, or change the execution directory.

## Alternatives considered

**Workflow actions in the context popup.** These mix navigation with model-visible evidence admission and hide a primary action beside the composer.

**Remount the conversation for each workflow.** This loses the composer DOM and can discard an unsent draft. The shared frame instead retains the conversation factory.

## Consequences

Navigation and context inspection have separate, discoverable locations. Tests verify composer identity and unsent text across view changes, cancellation of obsolete motion, collapsed-rail accessible labels, portal placement, and all three dismissal routes. The selected views currently share native chat content; this change does not claim completed editors, readers, or manuscript layouts.
