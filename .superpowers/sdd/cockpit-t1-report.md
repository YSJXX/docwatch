# Cockpit Task 1 Report

## Built
- Added `src/pages/preview/[...id].astro` as an SSR-only bare document preview route with `export const prerender = false`.
- Reads the normalized catch-all id from `Astro.params.id`, resolves a single `docs` collection entry with `getEntry('docs', id)`, and returns a tiny escaped 404 HTML response when the entry is missing.
- Uses Astro 5 `render(entry)` and renders the returned `Content` inside `<article class="doc">` with standalone GitHub-light document CSS copied from the approved variant-G `.doc` rules.
- Reuses `src/components/Mermaid.astro` at the end of `<body>` so Mermaid code fences render client-side.
- Avoids Starlight layout/components; the page contains no sidebar, header, or search chrome.

## Smoke Evidence
- Requested port 4321 was already occupied by an existing dev listener before this task's smoke server could bind. That listener served the new route with `200` and the missing route with `404`, but Astro dev-toolbar metadata injected `@astrojs/starlight`, making the requested grep unsuitable for no-chrome evidence.
- Clean smoke was run on port 4322 with the Astro dev toolbar temporarily disabled and then restored:

```text
200
      1 <article
      4 <h2
      2 모바일 프레임워크
404
```

- Clean smoke rendered global `.doc h1` CSS and `<article class="doc"><h1 ...>`, confirming Markdown children receive the document typography.
- Smoke server was stopped with the foreground session interrupt; node net-probe confirmed port 4322 was `FREE`.

## Gates
- `npm run typecheck`: passed.
- `npm run test:unit`: passed, 6 files / 36 tests.
- `npm run test:integration`: passed, 2 files / 4 tests.

## Commit
- Subject: `feat: bare document preview route for cockpit`
- SHA: reported in the final task reply after commit creation.
