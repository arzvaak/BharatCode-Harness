#!/usr/bin/env bash
# Brand tripwire: the upstream product name must not appear in fork-owned
# source after the BharatCode rebrand. Attribution to upstream lives only in
# the allowlist below (README pair, LICENSE, brand guidelines, docs/, the
# archived agent notes, and the one spec that asserts the upstream docs'
# own headings).
#
# Exit 0 = clean, exit 1 = brand regression found.
set -euo pipefail
cd "$(dirname "$0")/../.."

# scripts/snapshots/translation-prompt-v4/ is generated from docs/i18n (the
# allowlisted terminology corpus), so it inherits the same attribution carve-out.
ALLOW='^(README\.md|README\.zh\.md|LICENSE|BRAND_GUIDELINES|docs/|\.agents/|\.github/|scripts/project-doc-site\.spec\.ts|scripts/snapshots/translation-prompt-v4/)'

HITS=$(grep -rn "DeepSeek Harness" \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.mts' \
  --include='*.json' --include='*.jsonl' --include='*.snap' --include='*.html' --include='*.webmanifest' \
  --include='*.md' --include='*.txt' --include='*.nsh' --include='*.h' --include='*.cmd' \
  --include='*.py' --include='*.toml' --include='*.yml' --include='*.yaml' \
  packages apps scripts website snapshots python native vendor 2>/dev/null \
  | grep -vE 'node_modules|/lib/|/dist/|/\.dist/|/\.generated/|\.desktop-build|/\.git/' \
  | grep -vE "$ALLOW" || true)

if [ -n "$HITS" ]; then
  echo "::error::Brand tripwire: 'DeepSeek Harness' found outside the allowlist:"
  echo "$HITS"
  exit 1
fi
echo "Brand tripwire: clean."
