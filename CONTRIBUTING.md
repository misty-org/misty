# Contributing to Misty

## Set up

Follow the [README](README.md) for requirements and getting a development build running: the
desktop app (Tauri, in `src/` and `src-tauri/`), the server (`server/`) and the `misty` CLI
(`cli/`). Then turn on the git hooks once per clone:

```sh
git config core.hooksPath .githooks
```

## Before you open a pull request

There is no hosted CI; the checks run on your computer through `.githooks`:

- Every commit runs a secret scan of the staged changes and the test suites the commit touches.
- Every push needs a clean tree and runs every suite.
- Run a suite by hand with `.githooks/checks.sh frontend|server|rust-cli|rust-desktop|all`, or
  the whole local gate with `npm run cli -- check all`.

Keep files small and split by responsibility (about 300 lines at most), extend an existing
component rather than adding a parallel one, and don't leave dead code behind.

## UI rules

[docs/ui](docs/ui/README.md) holds the shared UI rules (the monochrome palette and its few exceptions,
skeletons instead of loading text, tabs in the sidebar, and so on). Each feature folder under
[docs](docs/README.md) adds its own interface rules. Read the shared rules and the feature's README
before changing a surface.

## Commits

- Write the subject as a plain sentence that says what changed, for example "Agents read and act
  inside cross-origin frames on Windows".
- Commits are authored by the person alone: no `Co-Authored-By:` trailer and no AI attribution
  lines ("Generated with ...", tool or model names) in commit messages or pull request
  descriptions.
- Never change a database migration that has already run; add a new one.

## Security

Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes, not in a public issue.
