![demo](docs/assets/demo.gif)
<!-- TODO: Add the demo GIF before the first public release. -->

# docwatch

Run a live documentation dashboard for an agent workspace:

```sh
npx docwatch
```

docwatch is a local dev server for watching project artifacts as they change. It is not a token monitor or agent telemetry system. It watches the files that explain what is happening: docs, plans, runbooks, agent notes, and project instructions.

## What It Does

docwatch turns a target repository into a live Starlight documentation site plus a dashboard. The dashboard shows recent git activity, recently modified docs, dirty files, active plan signals, and category progress from Markdown checkboxes.

docwatch is a long-running dev server. It occupies one terminal while it is running.

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
| `--no-open` | Opens by default | Disable automatic browser opening. |

Examples:

```sh
npx docwatch ./my-project
npx docwatch ./my-project --port 5000 --no-open
```

## Configuration

Create `docwatch.config.ts` in the target repository to override the default include patterns and category labels:

```ts
export default {
  include: ['docs/**/*.md', '.claude/plans/**/*.md', 'AGENTS.md', 'README.md'],
  exclude: ['**/node_modules/**', '.git/**'],
  categories: [
    { name: 'ADRs', match: 'docs/adr/**' },
    { name: 'Plans', match: '.claude/plans/**' },
    { name: 'Project root', match: ['AGENTS.md', 'README.md'] },
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
