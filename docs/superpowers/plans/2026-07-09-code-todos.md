# docwatch Phase 2 — Code TODO/FIXME aggregation

> Aggregates in-code task markers (`TODO`/`FIXME`/`HACK`/`XXX`) from the target repo's
> source into a read-only rail section in `/monitor`, so you can watch the markers an
> agent leaves behind. Independent of Phase 1/3 (no preview renderer needed) — reuses the
> project-checklist rail infrastructure. Read-only monitoring only.

## Design of record
- **Scanner** `src/data/todos.ts`: globs source files, scans each line for a comment
  marker followed by `TODO|FIXME|HACK|XXX`, returns `{ file, line, tag, text }[]` (total
  capped). Requires a comment starter on the line (`//`, `#`, `/*`, `*`, `<!--`, `--`) so
  string literals like `"TODO"` don't false-positive.
- **Config** `todoGlobs` on `DocwatchConfig` (default = common source extensions), reusing
  the existing `exclude`. Opt-in / overridable via `docwatch.config.ts`.
- **Rail section** "코드 TODO" in `/monitor` col-one, below the checklist. Grouped by
  file; each item shows a colored tag badge (TODO=blue, FIXME=orange, HACK/XXX=red) +
  text + line number. **Read-only** (not clickable in this phase — source files aren't
  served by `/preview` or `/rawpreview`; click-to-open is a later enhancement).
- Rail now has four scrollable sections (timeline / tree / checklist / todos) — rebalance
  their flex so each stays usable.

## Global constraints
- Reuse `@/data/*` + `fast-glob` (already a dep). Read-only. No editing.
- Escape dynamic text (SSR JSX auto-escapes; keep it in the template, not raw innerHTML).
- Cap: skip files > ~512 KB; cap total TODO items (~200) to keep SSR fast.
- Container/Codex: prefer Codex for both new files and edits (broker is fresh); if a write
  fails, reset the broker (kill pid + rm `broker.json` + rm sessionDir) and retry, else
  Claude-direct. NEVER pkill; kill servers by PID. `rm -rf .astro` on root switch.

---

### Task 1 — Config `todoGlobs` + TODO scanner
**Files:** edit `src/data/config.ts`; create `src/data/todos.ts`.
- `config.ts`: add `todoGlobs: string[]` to `DocwatchConfig`; default
  `['**/*.{ts,tsx,js,jsx,mjs,cjs,astro,vue,svelte,py,go,rs,rb,java,kt,c,h,cpp,cs,php,sh}']`;
  carry it through `mergeConfig` (override ?? default).
- `todos.ts` (mirror `src/data/scan.ts` / `watch-files.ts` style):
  ```ts
  export type TodoTag = 'TODO' | 'FIXME' | 'HACK' | 'XXX';
  export type TodoItem = { file: string; line: number; tag: TodoTag; text: string };
  export async function scanTodos(rootDir: string, cfg: DocwatchConfig, maxItems?: number): Promise<TodoItem[]>;
  ```
  - fast-glob `cfg.todoGlobs` (cwd rootDir, ignore cfg.exclude, dot:true, absolute:true).
  - For each file: skip if `stat.size > 512*1024`; read utf8 (catch→skip); per line, match
    `/(?:\/\/|#|\/\*|\*|<!--|--)\s*.*?\b(TODO|FIXME|HACK|XXX)\b[:\-\s]*(.*)$/` — `tag` =
    group1 uppercased, `text` = group2 trimmed with trailing `*/` / `-->` stripped (may be
    empty). `line` is 1-based. `file` is posix rel.
  - Stop once `maxItems` (default 200) collected. Wrap in try/catch → return `[]`.
**Verify:** unit test (Task 3) + `npm run typecheck`. Smoke: `scanTodos` on docwatch finds
its own real markers (e.g. README TODO comment, any `// TODO`).
**Commit:** `feat: code TODO/FIXME scanner + config`

### Task 2 — Surface TODOs in /monitor rail
**Files:** edit `src/pages/monitor.astro`.
- SSR: `const todos = await scanTodos(root, DEFAULT_CONFIG);` then group by file into
  `todoGroups = [{ file, items: TodoItem[] }]` sorted by file; `todoTotal = todos.length`.
- Markup: new rail section after the checklist — head "🔧 코드 TODO" + count badge; body
  `#todo-list`: per group a `.todo-file` header (file path) then each item as
  `.todo-item` with `.todo-tag.<tag-lowercased>` + text + `.todo-line` (`:line`). Empty →
  "코드 TODO가 없습니다.".
- CSS (in the `is:global` block): `.todo-*` styles; tag colors TODO=`--md-sys-color-primary`
  / FIXME=`--dw-orange` / HACK,XXX=`--dw-red`. Rebalance `.timeline-list`/`.tree-list`/
  `.checklist-list`/`.todo-list` flex to ~1 1 25% each with `min-height`.
**Verify:** dev smoke against docwatch: `/monitor` shows the 코드 TODO section with real
markers; md/config/checklist unchanged. typecheck + gate green.
**Commit:** `feat: code TODO rail section in /monitor`

### Task 3 — Tests
**Files:** create `tests/unit/todos.test.ts`; edit `tests/e2e/monitor.spec.ts`;
maybe extend `tests/fixtures/setup-sample-repo.sh` with a source file containing a TODO.
- unit: temp dir with a `.ts` file containing `// TODO: alpha`, `// FIXME: beta`, a
  `"TODO"` string literal (must NOT match), and a non-source `.md`; assert scanTodos
  returns the two comment markers with correct tag/line/text and ignores the literal +
  non-source.
- e2e: add a source file with a TODO to `.spike/target`; assert `/monitor` `#todo-list`
  shows a `.todo-item` with the expected tag.
- Full gate: typecheck + unit + integration + e2e green.
**Commit:** `test: TODO scanner unit + /monitor todo-section e2e`

## Notes
- Later (Phase 2.1): make a TODO's file clickable — resolve to `/preview/<id>` (doc),
  `/rawpreview/<rel>` (watched), or extend the whitelist to open arbitrary source. Deferred
  to keep the security surface small.
- Keep noise down: comment-starter requirement + caps. If a repo is noisy, `todoGlobs`
  can be narrowed via `docwatch.config.ts`.
