#!/usr/bin/env bash
# Profile composition gate — catches the break class upstream tests cannot:
# the Cordis Loader WARNS and SKIPS a patch/bundle row that matches nothing, so
# an upstream rename or a bad plugin edit silently disables an override (search
# provider, model pin, our bundles…) without failing a single test.
#
# Compose a fresh profile in a throwaway HOME (no user layer can mask a broken
# template), fail on any Loader diagnostic, and assert our shipped bundle layer
# actually lands in the composed tree.
#
# Runs after `pnpm run build`. Usable locally as a pre-push check.
set -euo pipefail
cd "$(dirname "$0")/../.."

BIN=apps/cli/lib/bin.js
if [ ! -f "$BIN" ]; then
  echo "::error::$BIN not found — run 'pnpm run build' first"
  exit 1
fi

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

# Fresh HOME: composition must work for a brand-new end user. Strip any
# machine-local profile overrides that would hide a broken shipped template.
export HOME="$T"
unset DSH_HOME DSH_PROFILE DSH_DESKTOP_WEB_PORT 2>/dev/null || true

OUT="$T/out.txt"
ERR="$T/err.txt"

if ! node "$BIN" --profile ci --from-default-profile web --dump-config >"$OUT" 2>"$ERR"; then
  echo "::error::profile failed to compose:"
  cat "$ERR"
  exit 1
fi

# Healthy composition writes nothing to stderr (verified). Any Loader warning
# (skipped row, failed import, unknown id) lands there — fail loudly.
if [ -s "$ERR" ]; then
  echo "::error::Loader diagnostics during composition (silent-skip signal):"
  cat "$ERR"
  exit 1
fi

# Our shipped bundle must be present in the composed tree, not merely listed
# in a template nobody reads.
if ! grep -q '^- id: max-tokens-continue$' "$OUT"; then
  echo "::error::@local/max-tokens-continue missing from composed config"
  exit 1
fi
if ! grep -q '# == @deepseek-ai/dsh-web-app' "$OUT"; then
  echo "::error::dsh-web-app bundle layer missing from composed config"
  exit 1
fi

echo "profile composition OK ($(wc -l <"$OUT") lines, clean stderr)"
