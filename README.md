![demo](docs/assets/demo.gif)
<!-- TODO: Add the demo GIF before the first public release. -->

# docwatch

Run a live documentation dashboard for an agent workspace:

```sh
npx docwatch
```

docwatch is a local dev server for watching project artifacts as they change. It is not a token monitor or agent telemetry system. It watches the files that explain what is happening: docs, plans, runbooks, agent notes, and project instructions.

## Security / Trust

docwatch renders the target repository's Markdown as a live local site, including any raw HTML or scripts embedded in those docs. Only point docwatch at repositories you trust.

## What It Does

docwatch turns a target repository into a live Starlight documentation site plus a dashboard. The dashboard shows recent git activity, recently modified docs, dirty files, active plan signals, and category progress from Markdown checkboxes.

docwatch is a long-running dev server. It occupies one terminal while it is running.

## Views

Once the server is running, open it in your browser (default `http://localhost:4321`):

| Route | View |
| --- | --- |
| `/monitor` | Material 3 three-pane live cockpit: real-time activity timeline + file tree, selected-file detail, and a rendered document preview or plan-checklist tracker. Dark/light toggle. |
| `/cockpit` | Two-pane cockpit — dashboard rail on the left, document preview on the right. `/` redirects here. |
| `/dashboard` | Single-page dashboard — live activity, recent commits, and category progress. |
| `/preview/<id>` | Bare rendered view of a single document. |

## Supported Conventions

| Convention | Purpose |
| --- | --- |
| `docs/` | Product docs, ADRs, plans, runbooks, and other project documentation. |
| `.claude/plans/` | Claude Code planning artifacts. |
| `.omc/` | oh-my-claudecode output and runtime artifacts. |
| `AGENTS.md` | Workspace-level agent instructions. |
| `CLAUDE.md` | Claude Code project instructions. |
| `README.md` | Project overview and current entry point. |

## Options

| Option | Default | Description |
| --- | --- | --- |
| `targetDir` | Current working directory | Repository or workspace to watch. |
| `--port N` | `4321` | Port for the local dev server. |
| `--host <host>` | localhost | Bind the dev server to a specific host, e.g. 0.0.0.0 for container/remote access; defaults to localhost. |
| `--no-open` | Opens by default | Disable automatic browser opening. |

Examples:

```sh
npx docwatch ./my-project
npx docwatch ./my-project --port 5000 --no-open
```

## Configuration

A target-repository `docwatch.config.ts` override is not yet wired up — docwatch currently uses these built-in defaults:

```ts
const defaults = {
  include: ['docs/**/*.md', 'AGENTS.md', 'README.md', 'CLAUDE.md', '.omc/**/*.md', '.claude/plans/*.md'],
  exclude: ['**/node_modules/**', '.git/**', '.docwatch-cache/**'],
  categories: [
    { name: 'ADR',   match: 'docs/adr/**' },
    { name: 'PRD',   match: ['docs/prd*', '.omc/prd-*'] },
    { name: 'Plans', match: '.claude/plans/**' },
    { name: 'Root',  match: ['AGENTS.md', 'README.md', 'CLAUDE.md'] },
  ],
};
```

## Development

```sh
npm install
bash tests/fixtures/setup-sample-repo.sh .spike/target
npm run dev
```

## Roadmap

v1.1:

- FilterPanel
- Git history view
- Backlinks
- Mission replay

v1.2:

- Graph view
- Other agent conventions

## License

MIT
