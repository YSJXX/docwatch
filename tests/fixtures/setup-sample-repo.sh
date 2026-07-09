#!/usr/bin/env bash
set -euo pipefail
DEST="${1:-tests/fixtures/sample-repo}"
rm -rf "$DEST"; mkdir -p "$DEST/docs/adr"; cd "$DEST"
git init -q -b main
git config user.email test@example.com && git config user.name test
echo "# root" > README.md;                       git add . && git commit -q -m "chore: init"
echo "# ADR-001" > docs/adr/ADR-001.md;          git add . && git commit -q -m "docs: add ADR-001"
printf -- "- [x] foo\n" > docs/adr/ADR-002.md;   git add . && git commit -q -m "docs: add ADR-002"
cat > docs/hostile.md <<'EOF'
---
title: Hostile
status: Accepted
draft: yes
tags: single-string-not-array
pagefind: "true"
---
# Hostile
- [ ] survive
EOF
printf '{\n  "name": "sample-repo",\n  "version": "0.0.0",\n  "private": true\n}\n' > package.json  # dirty NEW watched config file
mkdir -p src
cat > src/app.ts <<'TS'
// TODO: implement the thing
export function run() {
  // FIXME: handle errors
  return 42; // HACK: magic number
}
const label = "TODO not a real marker";
TS
echo "# uncommitted" > NOTES.md   # dirty로 남김 (src/app.ts도 dirty로 남겨 TODO 스캔 대상)
