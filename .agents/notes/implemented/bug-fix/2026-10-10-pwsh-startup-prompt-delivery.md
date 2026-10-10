# Agent Note: Wait for PowerShell startup prompt delivery

Status: implemented

English | [中文](2026-10-10-pwsh-startup-prompt-delivery.zh.md)

## Problem

The Linux release unit suite intermittently returned clipped prompt text instead of the first PowerShell command after a shell reset. Its readiness timeline showed startup settling after the unique acknowledgement, while the controlled prompt was still in flight. That late prompt arrived after the next command was submitted and incorrectly settled its send before command output.

## Decision

PowerShell startup requires both the per-session acknowledgement and the delivered controlled prompt at the end of the captured viewport before returning the session. Existing backend stdin readiness and the absolute startup deadline remain required. Follow-up empty sends wait for prompt delivery; they neither resubmit setup nor change the timing bounds.

## Consequences

Consumers receive a session only after its startup prompt has arrived. Bash startup and the interactive-command readiness contract are unchanged. No persistence formats or public interfaces change.

## Verification

A deterministic backend regression case delivers the acknowledgement in one stdin-ready settlement and the prompt in the next. It failed before the change because startup returned after the first settlement. The existing real PowerShell Loader composition checks reset, cwd, environment, large output and command readiness together.

## Alternatives considered

Increasing test timeouts or retrying the complete suite would leave early settlement possible in the product. Waiting for a fixed delay would depend on host speed rather than observed prompt delivery.
