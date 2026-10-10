---
kind: upgrade-guide
description: Session creation without a Workspace or cwd uses a dedicated general chat subfolder instead of the Host launch directory.
---

# Independent chat folders

English | [中文](guide.zh.md)

## Change

Fresh `session.create` requests without `workspaceId` or `cwd` create a separate folder under `$DSH_HOME/chats`. General New Session creates an independent chat; explicit Workspace creation retains Workspace membership. Fresh installations do not register a default Workspace. Saved Sessions retain their existing working directories and membership.

## Migration

1. Callers that require a particular working directory must supply `cwd`, or supply `workspaceId` for a registered Workspace.
2. Use general New Session for an independent chat and the Workspace picker for a project chat.
3. Confirm that new independent chat folders appear under `$DSH_HOME/chats` and do not appear as registered Workspaces. No existing logs or folders require moving.
