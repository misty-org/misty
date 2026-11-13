# Contributing to Misty

## Repository layout

| Path | What lives there |
| --- | --- |
| `src/` | The React and TypeScript app, organized by feature under `src/features/`. Shared components are in `src/shared/ui`. |
| `src-tauri/` | The Tauri app in Rust. Each feature, with its macOS, Windows and Linux code, tests and worker programs, is in `src-tauri/features/<feature>/`. |
| `src-tauri/features/kiri/` | Kiri, the native layer that adds the web APIs the system webviews leave out. |
| `tasks/` | The dev runner behind `npm run tauri` and the Node tests for the scripts the app injects into pages. |
| `.githooks/` | The commit checks. There is no hosted CI. |

## Prerequisites

- Git, Node.js 24.12 or newer and npm 11 or newer.
- Rust through rustup. `rust-toolchain.toml` pins the version.
- Xcode on macOS, or Visual Studio Build Tools with the C++ workload and WebView2 on Windows.
- On macOS, an Apple Development signing certificate (create one in Xcode). Development builds are
  signed with it so Keychain access survives rebuilds. Set `MISTY_DEV_SIGNING_IDENTITY` if you have
  more than one.

## Get started

```sh
npm ci
npm run tauri dev
```

This starts Vite and the app together and rebuilds the native side when Rust changes. Until you
choose a server in the app, it has none; set `MISTY_PUBLIC_API_URL` in your shell to point it at a
Misty server's API.

To run a server and the rest of the stack locally, check out
[misty-server](https://github.com/misty-org/misty-server) and
[misty-cli](https://github.com/misty-org/misty-cli) beside this repository. misty-cli's README
covers setup, the local server stack and releases.

Turn on the git hooks once per clone:

```sh
git config core.hooksPath .githooks
```

## Checks

Every commit runs a secret scan of the staged changes and the test suites the change touches. Run
them by hand with `.githooks/checks.sh frontend|scripts|rust-desktop|all`.

- `npm run check` covers formatting, types, lint, the frontend tests, the script tests and the
  dependency audit.
- `cd src-tauri && cargo test` runs the app's Rust tests.

Keep files small and split by responsibility (about 300 lines at most), extend an existing
component rather than adding a parallel one, and don't leave dead code behind.

## UI rules

Everything visible is built from `src/shared/ui`. A feature combines shared components and doesn't
pick its own colors, borders, corners, sizes or spacing. If it needs a look the shared set doesn't
have, add it to `src/shared/ui` first. `src/tests/architecture/uiRules.ts` enforces this. Some of
the rules:

- Sentence case for labels, buttons and headings.
- No "Loading…" text; first loads use skeletons shaped like the content.
- Selections in menus are checkmarks, and long names fade out instead of ending in an ellipsis.
- Spacing comes from the 4px scale. Controls in one row share one height.
- Deleting always asks first.

## Commits

- Write the subject as a plain sentence that says what changed.
- Never change a database migration that has already run; add a new one.

## License

Misty is licensed under the [GNU AGPL-3.0-or-later](LICENSE), with the attribution term in
[NOTICE](NOTICE). By opening a pull request you agree that your contribution is licensed under the
same terms. Code taken from other projects keeps its license header and is credited in `NOTICE`.
Its license must be compatible with the AGPL: MIT, BSD, Apache-2.0, MPL-2.0 and LGPL are;
proprietary and non-commercial licenses are not.

## Security

Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes, not in a public issue.
