# Contributing

## Development Setup

Install dependencies:

```sh
npm install
```

Create the sample target repository used by local development and E2E tests:

```sh
bash tests/fixtures/setup-sample-repo.sh .spike/target
```

Start the dev server:

```sh
npm run dev
```

`npm run dev` expects a target repository. For local work, use `.spike/target` from the fixture command above or run the CLI against another target:

```sh
node bin/cli.mjs .spike/target --no-open
```

## Tests

Run unit tests:

```sh
npm run test:unit
```

Run integration tests:

```sh
npm run test:integration
```

Run E2E tests:

```sh
export LD_LIBRARY_PATH="$HOME/.local/chromium-libs:$LD_LIBRARY_PATH"
npm run test:e2e
```

Run the type checker:

```sh
npm run typecheck
```

## Commit Convention

Use concise Conventional Commit-style subjects:

- `feat: ...` for user-facing features
- `fix: ...` for bug fixes
- `test: ...` for test coverage
- `docs: ...` for documentation-only changes
- `build: ...` for package, release, or CI changes

## Pull Requests

PRs should include:

- A short summary of the behavior change
- Test evidence from the commands that were run
- Screenshots or terminal output when UI or CLI behavior changes
- Notes for any known limitations or follow-up work

Keep changes focused. Avoid unrelated refactors in feature or bug-fix PRs.
