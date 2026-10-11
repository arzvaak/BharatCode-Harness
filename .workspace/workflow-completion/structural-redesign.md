# Workflow structural redesign

The former workflow picker only changed presentation on the same conversation.
The new coordinator records workflow ownership and remembers an independent
conversation per project and workflow, preserving native session drafts and
history. Legacy view-only preferences migrate to Chat ownership. Creation is
asynchronous, deduplicated, and guarded against newer history, panel navigation,
project scope, and plugin disposal. First entry creates an empty session without
sending a model request.

Coding opens editor-first. Editor, Changes, and Checks are separate keyboard
navigable tool views, keeping Monaco mounted when hidden. Changes separates
captured diff from optional declared verification; Checks owns language actions.
Layout controls sit in one disclosure, document extras in another, and empty
Coding offers Files and Open project. Each workflow has a distinct accent.

Motion uses interruptible panel entrances, grid transitions and a shared spring
press response for pointer and keyboard controls. Reduced-motion changes cancel
active effects. The spring preserves velocity on reversal and restores existing
inline styles when settled or disposed. This addresses the workbench controls;
it does not claim a whole-app recreation of OpenGhost's extensive motion system.

## Reproducible visual verification

Start the existing browser fixture Vite config on port 5193, then run:

    node .workspace/workflow-completion/browser/redesign-probe.mjs

The probe uses real Monaco with isolated fixture host ports, independent drafts,
tool identity, diff semantics, keyboard tabs, press/release spring motion, live
reduced motion, light/dark themes, and 960px overflow checks. Screenshots and
video are ignored. Built-boot and independent-chats tests separately exercise
the assembled plugin graph and native host session creation/reload.
