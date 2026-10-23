<p align="center">
  <a href="https://discord.gg/B5WgSw6uX"><img src="https://img.shields.io/badge/Discord-5865F2?style=flat&amp;logo=discord&amp;logoColor=white" alt="Discord" /></a>
  <a href="https://mistysys.com"><img src="https://img.shields.io/badge/Website-31363F?style=flat" alt="Website" /></a>
  <a href="https://github.com/orgs/misty-org/projects/1"><img src="https://img.shields.io/badge/Roadmap-625380?style=flat&amp;logo=github&amp;logoColor=white" alt="Roadmap" /></a>
</p>

<h1 align="center">Misty</h1>

Misty is a desktop browser workspace. Tabs live in Spaces, pages open in split panes, and encrypted sync carries a workspace between computers. Agents work beside you in the same browsing context: they read and act on pages, run in their own small browser beside a chat, and remember what each Space has learned.

Misty is in development, and its everyday browser features and cross-device sync are still being built and verified. It runs as a native Tauri app on macOS and Windows, using each system's own webview.

## Repository layout

| Path | What lives there |
| --- | --- |
| `src/` | The React and TypeScript app, organized by feature under `src/features/`. |
| `src-tauri/` | The Tauri desktop shell in Rust, its native macOS and Windows code, and the helper services under `src-tauri/services/`. |
| `kiri/` | Kiri, the native web platform layer that supplies web APIs the system webviews leave out. |
| `server/` | The Go API (accounts, sync, files, memory) and the TypeScript apps under `server/apps/`, such as the agent runtime and journal collaboration. |
| `cli/` | The `misty` CLI for setup, the local server stack, checks and releases, plus the TypeScript build tasks in `cli/tasks/`. |
| `docs/` | What Misty is, one folder per feature, and plans. Start at [docs/README.md](docs/README.md). |
| `.githooks/` | The commit and push checks. There is no hosted CI. |

## Prerequisites

- Git, Node.js 24.12 or newer and npm 11 or newer.
- Rust through rustup. `rust-toolchain.toml` pins the toolchain, so rustup installs the right version on first build.
- The platform's native build tools: Xcode on macOS, or Visual Studio Build Tools with the C++ workload and WebView2 on Windows.
- On macOS, an Apple Development signing certificate (create one in Xcode). Development builds are signed with it so Keychain access survives rebuilds.
- For the local server stack, Docker Engine with Compose v2 and a Cloudflare account with a domain. [server/README.md](server/README.md) lists the token permissions.

## Get started

Install the CLI and the app's dependencies from the repository root:

```sh
cargo install --path cli --locked
misty setup desktop
```

`misty setup desktop` checks the Node.js version, runs `npm ci` and writes a `.env` that points the app at the local API. Point `MISTY_PUBLIC_API_URL` in that file at another Misty server to develop against it instead.

Keep packaged builds separate from the everyday `.env` with local `.env.staging` and `.env.production` files. These files are ignored by Git. Build with `MISTY_APP_ENV=staging` or `MISTY_APP_ENV=production`; each profile reads only its matching file and does not inherit `.env`. Without `MISTY_APP_ENV`, builds continue to use `.env`. The staging server guide below uses `127.0.0.1:8082` through an SSH tunnel, so the tunnel must be open while using a staging build. Production builds use the live API and website. The signed release and publishing workflow uses the separate `MISTY_RELEASE_*` settings in `cli/.env/release.env`.

Start the desktop app:

```sh
misty desktop dev
```

This runs Vite and the Tauri shell together, and rebuilds the native side when Rust changes. Two isolated copies can run side by side with `misty desktop dev --profile dev1` and `--profile dev2`, which is how cross-device sync is tested on one computer.

### Run the server stack

The development stack runs Postgres, the API, the agent runtime and a Cloudflare tunnel in Docker, and reaches the collaboration Worker on Cloudflare:

```sh
misty setup server
misty setup cloudflare --account ACCOUNT_ID --zone ZONE_ID --hostname api.example.com --apply
misty server up
misty server deploy
misty doctor server
```

`misty setup server` generates development keys under `server/.env/dev/` and keeps existing values on later runs. [server/README.md](server/README.md) covers each step, the environment files and the provider credentials, and [cli/README.md](cli/README.md) lists every CLI command.

## Checks

Turn on the git hooks once per clone:

```sh
git config core.hooksPath .githooks
```

Each commit then runs a secret scan and the suites its staged files touch, and each push runs every suite on a clean tree. Run them by hand at any time:

- `npm run check` covers formatting, types, lint, the frontend tests and the dependency audit.
- `.githooks/checks.sh frontend|scripts|server|rust-cli|rust-desktop|all` runs one hook suite, or all of them.
- `misty check app|server|cli|scripts|all` runs the CLI's gates, which include clippy and the Rust format checks.

On macOS the desktop suite also checks the Windows build through [cargo-xwin](https://github.com/rust-cross/cargo-xwin) (`cargo install --locked cargo-xwin` and `rustup target add x86_64-pc-windows-msvc`).

[CONTRIBUTING.md](CONTRIBUTING.md) explains how to prepare a pull request, and [SECURITY.md](SECURITY.md) explains how to report a vulnerability.

## License

Misty is released under the [MIT License](LICENSE).
