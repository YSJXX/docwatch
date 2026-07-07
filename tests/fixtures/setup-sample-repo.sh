#!/usr/bin/env bash
set -euo pipefail
DEST="${1:-tests/fixtures/sample-repo}"
rm -rf "$DEST"; mkdir -p "$DEST/docs/adr"; cd "$DEST"
git init -q -b main
git config user.email test@example.com && git config user.name test
echo "# root" > README.md;                       git add . && git commit -q -m "chore: init"
echo "# ADR-001" > docs/adr/ADR-001.md;          git add . && git commit -q -m "docs: add ADR-001"
printf -- "- [x] foo\n" > docs/adr/ADR-002.md;   git add . && git commit -q -m "docs: add ADR-002"
echo "# uncommitted" > NOTES.md   # dirty로 남김
