# Contributing to Misty

## Repository layout

| Path | What lives there |
| --- | --- |
| `src/` | The React and TypeScript app, organized by feature under `src/features/`. |
| `src-tauri/` | The Tauri desktop shell in Rust. Everything for one feature, with its native macOS and Windows code, its tests and its worker programs, is in `src-tauri/features/<feature>/`. |
| `src-tauri/features/kiri/` | Kiri, the native web platform layer that supplies web APIs the system webviews leave out. |
| `cli/` | The `misty` CLI for setup, the local server stack, checks and releases, plus the TypeScript build tasks in `cli/tasks/`. |
| `.githooks/` | The commit checks and the push guard. There is no hosted CI. |

## Prerequisites

- Git, Node.js 24.12 or newer and npm 11 or newer.
- Rust through rustup. `rust-toolchain.toml` pins the toolchain, so rustup installs the right version on first build.
- The platform's native build tools: Xcode on macOS, or Visual Studio Build Tools with the C++ workload and WebView2 on Windows.
- On macOS, an Apple Development signing certificate (create one in Xcode). Development builds are signed with it so Keychain access survives rebuilds.
- To run a server, Docker Engine with Compose v2 and a Cloudflare account with a domain. The development stack needs the same; [misty-server's README](https://github.com/misty-org/misty-server/blob/main/README.md) lists its token permissions.

## Get started

Run the CLI from the repository root. It asks what you want to do, one step at a time, including setting up this computer and building the app:

```sh
npm run cli
```

Install it to use plain `misty` instead, then install the app's dependencies:

```sh
cargo install --path cli --locked
misty setup desktop
```

`misty setup desktop` checks the Node.js version and runs `npm ci`. A development app uses the development stack's API until someone chooses a server in the app; set `MISTY_PUBLIC_API_URL` in your shell to develop against another Misty server. The repository root has no `.env`. The signed release and publishing workflow uses the `MISTY_RELEASE_*` settings in `cli/.env/release.env`.

Start the desktop app:

```sh
misty desktop dev
```

This runs Vite and the Tauri shell together, and rebuilds the native side when Rust changes. Two isolated copies can run side by side with `misty desktop dev --profile dev1` and `--profile dev2`, which is how cross-device sync is tested on one computer.

## Run the server stack

The development stack runs Postgres, the API and a Cloudflare tunnel in Docker, and reaches the collaboration Worker on Cloudflare:

```sh
misty setup server
misty setup cloudflare --account ACCOUNT_ID --zone ZONE_ID --hostname api.example.com --apply
misty server up
misty server deploy
misty doctor server
```

The server is its own repository. To run the development stack, clone [misty-server](https://github.com/misty-org/misty-server) beside this checkout, where the `misty` CLI finds it. `misty setup server` generates development keys under `~/.misty/.env/server/` and keeps existing values on later runs. [misty-server's README](https://github.com/misty-org/misty-server/blob/main/README.md) covers each step, the environment files and the provider credentials, and [cli/README.md](cli/README.md) lists every CLI command.

Then turn on the git hooks once per clone:

```sh
git config core.hooksPath .githooks
```

## Before you open a pull request

There is no hosted CI; the checks run on your computer through `.githooks`:

- Every commit runs a secret scan of the staged changes and every test suite the commit touches,
  to the end. A failure refuses the commit.
- A push runs no tests, since each commit was checked when it was made. It only refuses history
  the public repository must not contain.
- Run a suite by hand with `.githooks/checks.sh frontend|server|rust-cli|rust-desktop|all`, or
  the whole local gate with `npm run cli -- check all`.
- `npm run check` covers formatting, types, lint, the frontend tests and the dependency audit.
- On macOS the desktop suite also checks the Windows build through
  [cargo-xwin](https://github.com/rust-cross/cargo-xwin) (`cargo install --locked cargo-xwin` and
  `rustup target add x86_64-pc-windows-msvc`).

Keep files small and split by responsibility (about 300 lines at most), extend an existing
component rather than adding a parallel one, and don't leave dead code behind.

## UI rules

[AGENTS.md](AGENTS.md) holds the shared rules: the monochrome palette, skeletons instead of loading text,
tabs in the sidebar, and so on. Read them before changing a surface.

## Commits

- Write the subject as a plain sentence that says what changed, for example "Agents read and act
  inside cross-origin frames on Windows".
- Commits are authored by the person alone: no `Co-Authored-By:` trailer and no AI attribution
  lines ("Generated with ...", tool or model names) in commit messages or pull request
  descriptions.
- Never change a database migration that has already run; add a new one.

## License

Misty is licensed under the [GNU AGPL-3.0-or-later](LICENSE). By opening a pull request you agree
that your contribution is licensed under the same terms. New files from other projects keep their
license and copyright notice next to them, and must be compatible with the AGPL (MIT, BSD, Apache-2.0,
MPL-2.0 and LGPL are; proprietary and "non-commercial" licenses are not).

## Security

Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes, not in a public issue.
