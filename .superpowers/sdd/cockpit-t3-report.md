# Cockpit Task 3 Report

## Helper Design

- Added `buildDocIndex(entries)` in `src/data/paths.ts`.
- The helper builds a `Map<sourceRelPath, entryId>` using each entry's `filePath` relative to `DOCWATCH_ROOT` when available.
- If `filePath` is absent, it falls back through `idToSourceRel()` with configured include roots, then `id + '.md'`.
- Added `fileToDocId(fileRelPath, index)`.
- Lookup order is exact normalized POSIX path first, then a narrow fallback that only compares the last path segment case-insensitively within the same directory.
- Trailing-slash directory inputs such as `docs/superpowers/plans/` return `null`.

## RED/GREEN

- RED: `npm run test:unit -- tests/unit/doc-index.test.ts`
  - Failed as expected before implementation: `buildDocIndex is not a function`.
- GREEN: `npm run test:unit -- tests/unit/doc-index.test.ts`
  - Passed after implementation.

## Cockpit Changes

- `/cockpit` now builds the doc index once during SSR.
- Dirty-file rows and recent-commit rows become clickable only when at least one referenced git path resolves to an indexed document.
- Category headers keep the LED/progress bar and are no longer preview targets.
- Each category renders all of its indexed documents as compact nested `data-preview="/preview/<id>"` rows.
- Existing Task 2 click/key delegation, LIVE header, iframe, and empty state were left intact.

## Smoke Evidence

- Baseline before Task 3: Task prompt identified Task 2 cockpit output as 4 `data-preview` targets.
- Command: `DOCWATCH_ROOT=/home/ysj/Glance ASTRO_TELEMETRY_DISABLED=1 npx astro dev --port 4321 > /tmp/ck3.log 2>&1 & echo $! > /tmp/ck3.pid`
- `/cockpit` status: `200`
- After Task 3: `curl -s http://localhost:4321/cockpit | grep -oE 'data-preview="/preview/[^"]+"' | wc -l` => `27`
- Known ADR check: `grep -c 'preview/docs/adr/adr-001-mobile-framework-react-native-expo'` => `1`
- Cleanup: killed exact PID from `/tmp/ck3.pid`; node net-probe reported port `4321` free.

## Gates

- `npm run typecheck` passed.
- `npm run test:unit` passed: 7 files, 38 tests.
- `npm run test:integration` passed: 2 files, 4 tests.
- E2E intentionally not run for Task 3 per task instructions.

## Commit

- `d0808d144cd3d50bad18601b67a2e8eac7f6800d`
- `feat: map rail items to previewable documents + category doc lists`
