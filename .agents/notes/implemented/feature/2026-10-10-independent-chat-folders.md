# Agent Note: Independent chat folders

Status: implemented

English | [中文](2026-10-10-independent-chat-folders.zh.md)

## Problem

Startup registered a default Workspace, and general New Session inherited the current or recent Workspace. Blank independent Sessions could not accept input, so ordinary chat required a project association.

## Decision

General New Session creates an unregistered per-chat folder under `$DSH_HOME/chats`. Only explicit Workspace creation attaches membership. Startup restores a saved selection, or creates an independent blank chat for an empty history. Existing logs and memberships remain unchanged. The sidebar provides All chats and Workspaces views over the same history.

## Consequences

Independent chats have separate working directories without adding Workspace entries. Callers requiring a project must supply its Workspace or cwd explicitly. Existing chat logs keep their original paths.

## Verification

Host creation tests prove separate folders and explicit cwd handling. Client tests cover selection, supersession, and independent composer readiness. The real-host browser scenario covers empty startup, explicit Workspace attachment, general New Session, and reload. Linux AppImage smoke checks the packaged first-use behavior.

## Alternatives considered

Inheriting the current Workspace makes general chat depend on previous navigation. Sharing one working folder mixes files across chats. Registering generated folders as Workspaces clutters the project list. These alternatives do not provide independent chat storage and explicit project membership.
