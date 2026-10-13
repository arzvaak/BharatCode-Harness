# Research knowledge workspace verification

Date: 2026-10-13
Branch: `implementation/research-knowledge-workspace`
Implementation base: `a876b3f07d`

## Delivered behavior

Research now provides a native knowledge library with a topic home, bounded
Markdown discovery/search, note creation, in-app reading/editing, wikilinks and
Markdown links, backlinks, headings, source reading, exact passage citations,
external-file reconciliation, and a portable Obsidian vault ZIP. Reading uses
existing safe GFM/KaTeX rendering for tables, equations, code, footnotes and
figures. No separate graphics engine was introduced. Computational research
continues through the existing notebook jobs, inputs, cancellation and output
contracts.

Files remain ordinary Markdown. Discovery does not rewrite front matter or
`.obsidian/`. Portable citation footnotes retain exact captured source copies
in exports. Internal citation locators are hidden only in reading mode. Source
editing preserves metadata, wikilinks, unsupported syntax and recovery drafts.
Model tools can inspect the library, create notes, propose source-backed citations
without publishing edits, and capture citations against exact saved text.

## Automated evidence

Commands executed from the implementation checkout:

```sh
node_modules/.bin/vitest run packages/api/workspace-controller/tests packages/workspace/workspace/tests packages/client/ui-workspace/tests scripts/client-bundle-purity.spec.ts --reporter=dot
node_modules/.bin/tsc -b tsconfig.host.json tsconfig.client.json --pretty false
BC_NOTEBOOK_TEST_PYTHON=/mnt/slow-stuff/deepseek/sidebar-fix-20261013/workflow-python/bin/python node_modules/.bin/vitest run packages/api/workspace-controller/tests/notebook-runner.host.spec.ts --reporter=dot
```

- Main focused run: 46 files passed, one optional notebook file skipped;
  708 tests passed, three environment-gated notebook tests skipped.
- The three notebook tests were then run with the existing isolated Python
  environment: all passed, covering real execution, cell failure evidence,
  environment identity and cancellation.
- Full host and client TypeScript aggregate checks passed after generated Remote
  bindings were rebuilt. Pure Markdown helpers are explicitly permitted in the
  browser bundle; host filesystem operations remain host-only.
- Transport/browser-purity/knowledge UI checks: 61 passed before the additional
  exact-source editor acceptance case; the complete focused suite above includes
  that case.
- Commit hooks ran staged lint, whitespace and relevant manifest/notice checks.

## Independent review

A fresh reviewer reproduced citation-title confusion, overlapping nested links,
duplicate root basenames, percent-encoded filename hashes, second-citation
placement and per-marker export failure. Each was fixed with regression coverage.
Follow-up review identified trailing quotation newlines and linked-figure labels;
these were also fixed and tested. Literal code never becomes a backlink or a
hidden citation marker. Citation capture failure preserves saved Markdown and
returns a retryable incomplete-evidence receipt.

## Actual app verification

A separate preview used only a synthetic battery research project and private
preview state. It did not submit a model request or alter installed app data.

The browser flow verified:

1. Open the topic home and read linked notes, a table, a rendered equation and a
   local chart inside the app.
2. Create `notes/Findings.md`, insert a wikilink, read a captured source and insert
   two different source passages. Both footnote references render; saving reports
   saved/captured evidence.
3. Follow backlinks and open the exact captured revision through a footnote.
   Source freshness is shown separately from the immutable content.
4. Download the vault through Export to Obsidian. The ZIP integrity check passed:
   nine files, including linked notes, both citations, the captured source copy,
   the chart, and the notebook. No app-private or `.obsidian/` metadata was included.
5. Modify an open clean file externally: the native reader updates automatically.
   Modify disk again while an unsaved draft exists: the draft remains readable,
   saving is disabled, and the conflict asks the person to compare disk content.
   Private recovery also survived the development preview's reload.
6. Inspect desktop, 720px and 480px layouts. At 720px the document width is 720px
   and reader scroll width equals its client width; at 480px the document width is
   480px and the reader measures 382px without horizontal overflow. Local figures
   report loaded pixels. Temporary viewport overrides were reset.

## Local artifacts and limits

Screenshots and a sample vault are retained under
`.artifacts/research-knowledge-workspace/`: `reader-desktop.png`,
`reader-figures.png`, `reader-narrow.png`, `reader-compact.png`,
`draft-conflict.png`, and `research-vault-example.zip`.

The sample vault SHA-256 is
`42e298c4b4a6e9ddb8a883210d631806b269c4dd8fffc6799d9d4a2f7267ae58`.
The compatibility fixture and ZIP were verified without launching Obsidian itself.
This is implementation and development-preview evidence, not installer,
installed-app, cross-platform release or publication qualification. Graph/Canvas,
Obsidian plugins, cloud sync and new binary-document extraction remain outside
this implementation. Existing binary-resource previews remain available.

Release preparation, packaging, qualification, publishing and installation must
be delegated to `gpt-6-luna` with `max` reasoning under the user's global rule.
