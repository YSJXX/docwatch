# docwatch Phase 1 — Watched non-md files (config/manifest) + raw-file preview

> Broadens docwatch from a markdown viewer to a project-state monitor. Phase 1 adds **config/manifest files** (package.json, pyproject.toml, Dockerfile, CI workflows, …) to the watch set, with a new **raw-file code preview**. This is "갈래 A" — the foundation that Phase 3 (diagrams, specs) will reuse. Read-only monitoring only (viewer principle).

## Design of record
- **Two layers stay separate.** The existing markdown `docs` content collection is untouched (frontmatter schema + md render). Non-md watched files live in a **parallel layer** (fast-glob), never in the `docs` collection.
- **Raw-file preview route** `/rawpreview/[...path]` renders any watched non-md file as syntax-highlighted code using Astro's built-in Shiki via `import { Code } from 'astro:components'` — **no new dependency**. Same light-doc chrome as `/preview`.
- **Security:** `/rawpreview` validates its `path` against the watched-files set (recomputed server-side) and rejects anything with `..`, absolute paths, or a resolved path outside the target root. Never read an arbitrary path.
- **Unified selection:** the `/monitor` client switches from **id-keyed** to **URL-keyed** selection so a `data-preview` can be either `/preview/<id>` (md) or `/rawpreview/<rel>` (config). `details` is keyed by the preview URL.
- **Config is opt-in / overridable** per repo via `docwatch.config.ts` (a new `watchFiles` glob list with a sensible default).

## Global constraints
- Reuse `@/data/*`, `scanDiff`, `getActivity`, the existing tree/timeline/detail machinery. Do NOT re-implement scanning.
- Read-only. No editing/mutating watched files.
- Escape all dynamic text; the rawpreview route must escape the path in any error output and must NOT reflect unvalidated input.
- Container workflow: **new files → Codex** (`codex:codex-rescue`, create path works), **edits of existing files → Claude** (apply_patch is broken here). Verify each step (typecheck + gate). NEVER `pkill`; kill servers by PID only. `rm -rf .astro` when switching `DOCWATCH_ROOT`.

---

### Task 1 — Watch-files config + scanner
**Files:** edit `src/data/config.ts` (Claude); create `src/data/watch-files.ts` (Codex).
- `config.ts`: add `watchFiles?: string[]` to `DocwatchConfig`; add a default to `DEFAULT_CONFIG.watchFiles`:
  `['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'tsconfig*.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'Dockerfile', 'docker-compose.{yml,yaml}', '*.config.{js,ts,mjs,cjs}', '.github/workflows/*.{yml,yaml}']`
  Extend `mergeConfig` to carry `watchFiles` (override wins, else default). Add a `Category`-like icon later if needed (optional).
- `watch-files.ts` (new): `export type WatchedFile = { rel: string; abs: string };` and
  `export async function scanWatchedFiles(rootDir: string, cfg: DocwatchConfig): Promise<WatchedFile[]>` — fast-glob `cfg.watchFiles` under `rootDir` (absolute:true, ignore:cfg.exclude, dot:true), return `{rel, abs}` sorted by rel. Also export `export function isWatchedRel(rel: string, files: WatchedFile[]): boolean` for the preview route's validation.
**Verify:** unit test (Task 4) + `npm run typecheck`.
**Commit:** `feat: watched-files config + scanner for non-md monitoring`

### Task 2 — Raw-file preview route (Shiki)
**Files:** create `src/pages/rawpreview/[...path].astro` (Codex). `export const prerender = false`.
- Read `path = Astro.params.path`. **Validate:** reject if empty, contains `..`, is absolute, or (after `scanWatchedFiles(root, cfg)`) not in the watched set → return 404 (small escaped body).
- Read the file (`fs.readFile(join(root, path))`, catch → 404).
- Language from extension: map (`package.json`/`tsconfig*`/`*.json`→`json`, `*.toml`→`toml`, `*.yml`/`*.yaml`→`yaml`, `Dockerfile`→`dockerfile`, `*.ts`→`typescript`, `*.js`/`*.mjs`/`*.cjs`→`javascript`, else `text`).
- Render with `import { Code } from 'astro:components'`: `<Code code={content} lang={lang} theme="github-light" />` inside the same light-doc layout as `/preview` (reuse its `<style>` shell: crumb + article container; cap very large files, e.g. first ~2000 lines, with a note).
**Verify:** dev smoke against a repo with `package.json`: `curl -s /rawpreview/package.json | grep -c '<pre'` ≥ 1; a traversal attempt `/rawpreview/../../etc/passwd` → 404; a non-watched file (`src/data/scan.ts`) → 404.
**Commit:** `feat: /rawpreview route — syntax-highlighted preview for watched files`

### Task 3 — Integrate watched files into /monitor (tree, details, timeline, URL-keyed client)
**Files:** edit `src/pages/monitor.astro` (Claude).
- **SSR:** after building md `docSources`/`details`, `scanWatchedFiles(root, cfg)`; for each watched file build a detail `{ name, dir, path: rel, status(dirtyByRel or 'DOC'), size, created, lines, kind:'config', diff(if MOD), preview:`/rawpreview/<rel>` }` and add to a **URL-keyed** `details` map (key = preview URL). Also key the md docs by their `/preview/<id>` URL. (Migrate `details` from id-keyed to URL-keyed.)
- **Tree:** merge watched files into `buildTree` input (they get `data-preview=/rawpreview/<rel>`); show a small `⚙` icon or a `CFG` badge to distinguish from docs.
- **Timeline:** when a dirty/recent file resolves to a watched file (not a doc), make it clickable with `/rawpreview/<rel>`.
- **Client refactor (id → URL):** `data-preview` carries the full URL. `select(url, target)` → `fillDetail(url)` (details[url]) + set `#doc-frame` src = url (guard: `startsWith('/preview/') || startsWith('/rawpreview/')`) + `history ?doc=url`. Drop `idFromPreview`/id reconstruction. `?doc=` on load reuses the same guard. Keep `applyActivity` mapping updated (map `detail.path` for both docs and config).
- col2 detail for a config file: meta chips + diff (reuse existing) — no excerpt/plan.
**Verify:** dev smoke against `/home/ysj/docwatch`: `/monitor` shows `package.json` in the tree; clicking it loads `/rawpreview/package.json` (highlighted) in col3; a dirty config file appears clickable in the timeline; md docs still work. typecheck + gate green.
**Commit:** `feat: surface watched config files in /monitor (tree, timeline, code preview)`

### Task 4 — Tests
**Files:** create `tests/unit/watch-files.test.ts` (Codex); edit `tests/e2e/monitor.spec.ts` (Claude).
- unit: `scanWatchedFiles` picks up a fixture `package.json`/`tsconfig.json`, ignores excludes; `isWatchedRel` true/false; lang-from-ext mapping if exported.
- e2e: on `/monitor`, a watched file (e.g. `package.json` — add to `.spike/target` fixture if absent) appears in the tree with `data-preview="/rawpreview/package.json"`; clicking loads the code preview (`#doc-frame` src matches `/rawpreview/`); traversal `?doc=/rawpreview/../../etc/passwd` is ignored (frame not pointed outside).
- Full gate: typecheck + unit + integration + e2e green.
**Commit:** `test: watched-files scanner unit + /monitor config-file e2e`

---

## Notes
- Phase 3 reuses `/rawpreview` + the watched-files layer: diagrams (`.mermaid`/`.svg` → mermaid/svg render branch in the route), specs (`openapi.yaml` → code view now, pretty later).
- Fixture: `.spike/target` may need a `package.json` + a `tsconfig.json` added by `setup-sample-repo.sh` for deterministic e2e.
- The `Code` component highlights at SSR; large files should be truncated to keep it fast.
- Keep `/api/activity.json` + SSE working; watched-file changes already flow through git dirty / recentlyModified (getActivity), so live push covers them once they're clickable.
