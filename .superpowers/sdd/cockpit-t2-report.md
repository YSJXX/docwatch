# Cockpit Task 2 Report

## Files
- `src/layouts/CockpitLayout.astro`
- `src/pages/cockpit.astro`
- `.superpowers/sdd/cockpit-t2-report.md`

## Data Sourcing
- LIVE strip data is SSR-sourced from the existing data layer in `src/pages/cockpit.astro`:
  - `targetRepoRoot()` for the target repo root.
  - `path.basename(root)` for `repoName`.
  - `getCollection('docs')` for `docsTotal`.
  - `getActivity(root, DEFAULT_CONFIG)` for `dirtyCount` and dirty rows.
- Category aggregation reuses the dashboard path:
  - Resolve each collection entry to a target-relative source path via `absFromEntry((entry as any).filePath, astroRoot)` when available.
  - Fall back to `idToSourceRel(entry.id, includeRoots)` when `filePath` is unavailable.
  - Read source markdown from the target repo and pass `{ sourceRelPath, content }` to `aggregateByCategory(entries, DEFAULT_CONFIG.categories)`.
- Category-to-preview mapping uses the first doc whose target-relative source path resolves to the category with `resolveCategory(sourceRelPath, DEFAULT_CONFIG.categories)`.
  - Clickable category rows render `data-preview="/preview/<firstDocId>"`.
  - Categories without a resolvable first doc render without `data-preview`.

## Smoke Evidence
- Dev smoke used `DOCWATCH_ROOT=/home/ysj/Glance`, `ASTRO_TELEMETRY_DISABLED=1`, port `4321`.
- The plain background `npx astro dev --port 4321` launcher exited immediately in this execution surface with an empty `/tmp/ck.log`; the verified smoke used the local Astro binary under `setsid` with the same env, port, log, and PID-file cleanup semantics.
- `/cockpit` HTTP status: `200`.
- `/dashboard` HTTP status: `200`.
- Markup grep evidence:

```text
      1 LIVE
      1 class="rail"
      1 data-preview="/preview/agents"
      1 data-preview="/preview/docs/adr/adr-001-mobile-framework-react-native-expo"
      1 data-preview="/preview/docs/runbook-oracle-cloud-deployment"
      1 data-preview="/preview/omc/plans/channel-summarize-opt-in"
      1 id="doc-frame"
      1 id="empty-state"
```

- Sample preview value: `data-preview="/preview/agents"`.
- Shutdown used `/tmp/ck.pid` exact PID kill only; Node bind probe confirmed `port 4321 free`.

## Gates
- `npm run typecheck`: pass.
- `npm run test:unit`: pass, 6 files / 36 tests.
- `npm run test:integration`: pass, 2 files / 4 tests.
- E2E not run, per Task 2 instruction.

## Commit
- Subject: `feat: cockpit two-pane shell with preview iframe`
- SHA: reported in the final task reply after commit creation.
