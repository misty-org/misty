<p align="center">
  <a href="https://discord.gg/B5WgSw6uX"><img src="https://img.shields.io/badge/Discord-5865F2?style=flat&amp;logo=discord&amp;logoColor=white" alt="Discord" /></a>
  <a href="https://mistysys.com"><img src="https://img.shields.io/badge/Website-31363F?style=flat" alt="Website" /></a>
  <a href="https://github.com/orgs/misty-org/projects/1"><img src="https://img.shields.io/badge/Roadmap-625380?style=flat&amp;logo=github&amp;logoColor=white" alt="Roadmap" /></a>
</p>

<h1 align="center">Misty</h1>

Misty is a desktop browser workspace. Tabs live in Spaces, pages open in split panes, and encrypted sync carries a workspace between computers. Agents work beside you in the same browsing context: they read and act on pages, run in their own small browser beside a chat, and remember what each Space has learned.

Misty is in development, and its everyday browser features and cross-device sync are still being built and verified. It runs as a native Tauri app on macOS and Windows, using each system's own webview.

Misty is built by one person, Matthew Chen, with heavy use of AI coding agents. He decides what gets built and how it works, and the code is here for anyone to judge.

Misty is free and open source under the AGPL-3.0. Browse with no account at all, run your own server for sync, Spaces and agents from one Compose file with every feature on ([docs/self-hosting.md](docs/self-hosting.md)), or use Misty Pro, a server set up for you for about $10 a month ([docs/cloud/](docs/cloud/README.md)). Agents run on your own computer, on models you choose: Sign in with ChatGPT, OpenRouter, Ollama Cloud, a local Ollama or your own keys. AI is never charged for, and your keys never leave your computer ([docs/byok.md](docs/byok.md), [docs/agents/runtime.md](docs/agents/runtime.md)). Only your vault is sealed from the server: agent conversations are stored on your server, including what an agent reads on a signed-in page, where whoever runs the server can read them and backups keep them for up to 30 days after deletion ([docs/agents/README.md](docs/agents/README.md)). A server runs on your own Cloudflare account, which its setup container provisions ([docs/cloudflare.md](docs/cloudflare.md)).

## Repository layout

| Path | What lives there |
| --- | --- |
| `src/` | The React and TypeScript app, organized by feature under `src/features/`. |
| `src-tauri/` | The Tauri desktop shell in Rust, its native macOS and Windows code, and the services the desktop runs under `src-tauri/services/`, such as the agent runtime. |
| `kiri/` | Kiri, the native web platform layer that supplies web APIs the system webviews leave out. |
| `cli/` | The `misty` CLI for setup, the local server stack, checks and releases, plus the TypeScript build tasks in `cli/tasks/`. |
| `docs/` | What Misty is, one folder per feature, and plans. Start at [docs/README.md](docs/README.md). |
| `.githooks/` | The commit and push checks. There is no hosted CI. |

## Prerequisites

- Git, Node.js 24.12 or newer and npm 11 or newer.
- Rust through rustup. `rust-toolchain.toml` pins the toolchain, so rustup installs the right version on first build.
- The platform's native build tools: Xcode on macOS, or Visual Studio Build Tools with the C++ workload and WebView2 on Windows.
- On macOS, an Apple Development signing certificate (create one in Xcode). Development builds are signed with it so Keychain access survives rebuilds.
- To run a server, Docker Engine with Compose v2 and a Cloudflare account with a domain ([docs/self-hosting.md](docs/self-hosting.md)). The development stack needs the same; [misty-server's README](https://github.com/misty-org/misty-server/blob/main/README.md) lists its token permissions.

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

### Run the server stack

The development stack runs Postgres, the API and a Cloudflare tunnel in Docker, and reaches the collaboration Worker on Cloudflare:

```sh
misty setup server
misty setup cloudflare --account ACCOUNT_ID --zone ZONE_ID --hostname api.example.com --apply
misty server up
misty server deploy
misty doctor server
```

The server is its own repository. To run the development stack, clone [misty-server](https://github.com/misty-org/misty-server) beside this checkout, where the `misty` CLI finds it. `misty setup server` generates development keys under `~/.misty/server/dev/` and keeps existing values on later runs. [misty-server's README](https://github.com/misty-org/misty-server/blob/main/README.md) covers each step, the environment files and the provider credentials, and [cli/README.md](cli/README.md) lists every CLI command.

## Checks

Turn on the git hooks once per clone:

```sh
git config core.hooksPath .githooks
```

Each commit then runs a secret scan and the suites its staged files touch, and each push runs every suite on a clean tree. Run them by hand at any time:

- `npm run check` covers formatting, types, lint, the frontend tests and the dependency audit.
- `.githooks/checks.sh frontend|scripts|agent-runtime|rust-cli|rust-desktop|all` runs one hook suite, or all of them. A commit checks what it touched and takes at most 5 minutes; a push runs everything; `release` also compiles for Windows.
- `misty check app|server|cli|scripts|all` runs the CLI's gates, which include clippy and the Rust format checks.

On macOS the desktop suite also checks the Windows build through [cargo-xwin](https://github.com/rust-cross/cargo-xwin) (`cargo install --locked cargo-xwin` and `rustup target add x86_64-pc-windows-msvc`).

[CONTRIBUTING.md](CONTRIBUTING.md) explains how to prepare a pull request, and [SECURITY.md](SECURITY.md) explains how to report a vulnerability.

## License

Copyright (C) 2026 Matthew Chen.

Misty is free software: you can redistribute it and modify it under the terms of the
[GNU Affero General Public License](LICENSE), version 3 or (at your option) any later version.
If you share a changed Misty, or run a changed Misty server that other people use over a network,
you must offer them the source of your changes under the same license. Misty comes with no
warranty; see the license for details. Code adapted from other projects keeps its own license
next to it (for example `src-tauri/vendor/`).

Under section 7(b) of the license, anyone who conveys Misty or a work based on it, or offers it
to others over a network, must keep the author attribution in [NOTICE](NOTICE) and show it where
the program shows its legal notices.
