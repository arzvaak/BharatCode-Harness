# BharatCode English workflow integrations

English | [中文](README.zh.md)

Eight pinned plugin forks add writing continuity, close reading, a local source library, citation retrieval, GitHub review, language-server actions, browser research, and a task board to the existing UI. `registry.json` records every source revision, package, tarball, checksum, bundle patch, purpose, test result, and limitation. Canonical sources and original licenses remain under `upstream/`; editable forks are under `packages/`.

Install the tarballs using the native host plugin inventory and compose their declared bundle patches. GitHub and Task Board supply ModuleLoader browser factories. GitHub uses the native `settings.section` slot; Task Board adds its existing navigation and execution surfaces. The other six additions expose host tools and reuse the existing workspace, reader, and writing UI.

The novel package is explicitly a bounded fork of dsh-novel-writer's canonical project/chapter/lore/continuity engine. DeepRead is explicitly a bounded fork of the original extraction, chunk synthesis, JSON retry, report, PDF, budget, cache, and calibration engine. Their duplicate workbenches and unrelated modes are omitted. These scopes are listed in package README files and registry entries. Author-owned descriptions, prompts, failures, configuration help, continuation delimiters, and UI dictionaries are English. Input recognizers may still recognize multilingual source text, and user-authored source content remains intact.

Verification used isolated temporary project directories, mock GitHub/Zotero/model services, local browser fixtures, and existing cached Chromium. Task Board passed 833 checks (one optional test skipped), Library 89, LSP Actions 368 (nine skipped), GitHub 185 (three external checks skipped), and Browser 47 local fixture checks. Zotero, Novel Continuity, and DeepRead each passed real ToolRuntime smoke tests with registration and disposal. Live authenticated services and a real model report are not claimed as verified.

GitHub needs credentials for authenticated operations. Zotero needs its local desktop API or a configured Web API library. Browser model extraction and DeepRead reports need a model. LSP Actions needs a server mapping or the official LSP seam; its default empty map reports an English unavailable failure. A separate reviewed TS/JS server helper may be supplied alongside this registry. Native app qualification is performed by the parent integration task.
