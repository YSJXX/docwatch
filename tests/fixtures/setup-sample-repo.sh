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
printf 'graph TD\n  A[Start] --> B[End]\n' > docs/flow.mmd                 # dirty diagram (mermaid)
printf '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="30"><rect width="80" height="30" fill="#0969da"/></svg>\n' > docs/diagram.svg  # dirty diagram (svg)
printf 'openapi: 3.0.0\ninfo:\n  title: API\n  version: 1.0.0\npaths: {}\n' > docs/openapi.yaml  # dirty spec
echo "# uncommitted" > NOTES.md   # dirty로 남김 (src/app.ts·diagram·spec도 dirty로 남겨 스캔 대상)
