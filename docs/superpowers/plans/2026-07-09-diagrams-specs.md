# docwatch Phase 3 — Diagrams + specs in /rawpreview

> Extends the Phase 1 watched-files layer + `/rawpreview` route to (a) watch API/spec files
> (OpenAPI, GraphQL, proto, prisma) — rendered as highlighted code — and (b) render
> **diagrams**: `.mermaid`/`.mmd` as actual Mermaid diagrams (reusing the existing Mermaid
> client component) and `.svg` inline (safely, via an `<img>` data URI). Read-only.

## Design of record
- **Specs are just code.** Add spec globs to `watchFiles`; `/rawpreview` already renders any
  watched file as Shiki-highlighted code. Only new work: a couple of language mappings.
- **Diagrams need a render branch in `/rawpreview`**, keyed by extension:
  - `.mermaid` / `.mmd` → emit `<pre><code class="language-mermaid">…</code></pre>` and mount
    the existing `<Mermaid />` component (which finds `pre > code.language-mermaid` and swaps
    in the rendered SVG). No new dependency.
  - `.svg` → render via `<img src="data:image/svg+xml;base64,…">`. Using `<img>` (not inline
    `set:html`) means the browser will NOT execute scripts inside the SVG — safe.
  - else → the existing `<Code>` path.
- **Noise control:** `.svg` is scoped to `docs/**/*.svg` (likely diagrams, not icon assets).
  All globs remain overridable via `docwatch.config.ts`.
- Security unchanged: `/rawpreview` still validates the path against the watched-files set +
  rejects traversal, before reading anything.

## Global constraints
- Reuse `@/data/*`, the existing `/rawpreview` validation, and `Mermaid.astro`. Read-only.
- Container/Codex is unreliable (broker degrades ~30 min → os-error-2); do this Claude-direct.
- NEVER pkill; kill servers by PID. `rm -rf .astro` on root switch.

---

### Task 1 — Extend watched globs + spec languages
**Files:** edit `src/data/config.ts`.
- Append to `DEFAULT_CONFIG.watchFiles`:
  `'openapi*.{yaml,yml,json}', 'swagger*.{yaml,yml,json}', '*.graphql', '*.gql', '*.proto', '*.prisma', '*.mermaid', '*.mmd', 'docs/**/*.svg'`.
**Verify:** `npm run typecheck`; a glob smoke that these match sample files.
**Commit:** `feat: watch diagram + spec files (openapi/graphql/proto/mermaid/svg)`

### Task 2 — Render diagrams in /rawpreview
**Files:** edit `src/pages/rawpreview/[...path].astro`.
- After validation/read, compute a render `mode` from the extension:
  `mermaid` for `.mmd`/`.mermaid`; `svg` for `.svg`; else `code`.
- `langOf`: add `.graphql`/`.gql` → `graphql`; keep everything else, unknown → `text`
  (Astro `<Code>` must get a lang Shiki knows; `.proto`/`.prisma` → `text` to avoid errors).
- SVG mode: `const svgDataUri = 'data:image/svg+xml;base64,' + Buffer.from(content).toString('base64')`.
- Template branches on `mode`:
  - `mermaid` → `<pre><code class="language-mermaid" set:text={code}></code></pre>` + `<Mermaid />` (import from `@/components/Mermaid.astro`). Add a `.mermaid-rendered { … }` style so the diagram has room.
  - `svg` → `<img src={svgDataUri} alt={rel} style="max-width:100%;height:auto" />`.
  - `code` → the existing `<Code code={code} lang={lang} theme="github-light" />`.
- Keep the crumb + `CONFIG`→ a mode-aware badge (`DIAGRAM` for mermaid/svg, `CONFIG`/`SPEC` else — keep simple: `DIAGRAM` vs `FILE`).
**Verify:** dev smoke: `/rawpreview/docs/x.mmd` returns a page with a `language-mermaid` block
+ the Mermaid script; `/rawpreview/docs/x.svg` returns an `<img data:image/svg+xml`. An
`openapi.yaml` still renders as highlighted code. Traversal/non-watched still 404.
**Commit:** `feat: /rawpreview renders mermaid diagrams + inline svg`

### Task 3 — Tests + fixtures
**Files:** edit `tests/fixtures/setup-sample-repo.sh` (add `docs/flow.mmd`, `docs/diagram.svg`,
`openapi.yaml` — dirty); edit `tests/e2e/monitor.spec.ts`; add unit if useful.
- e2e: a `.mmd` file appears in the tree (⚙) and opens `/rawpreview/docs/flow.mmd`; the
  preview iframe contains a `.language-mermaid` (or rendered `svg`) — assert the frame shows
  a `pre code.language-mermaid` OR a mermaid `svg`. An `openapi.yaml` opens as code (`pre`).
- Full gate: typecheck + unit + integration + e2e green.
**Commit:** `test: diagram/spec rawpreview e2e + fixtures`

## Notes
- Deferred: `.excalidraw` / `.drawio` / `.puml` need dedicated renderers (heavier) — a later
  pass; for now they'd fall through to the `code` branch if added to globs.
- Mermaid renders client-side in the iframe; the existing Mermaid component keeps the raw
  code block if the diagram fails to parse (graceful).
