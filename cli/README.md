# misty

`misty` is the development and desktop release CLI for this repository. It never deploys a server: a server runs from `server/compose.yml` and its setup container ([docs/self-hosting.md](../docs/self-hosting.md)). It finds the checkout from any directory inside it; set a fallback with `misty configure --workspace /path/to/misty-org`, which is saved in `~/.misty/cli/config.toml`.

```sh
cargo install --path cli --locked
```

Reinstall after changing the CLI, or run this checkout's code directly with `npm run cli -- <command>`. Run `misty --help`, or add `--help` after any command, for the full option reference.

## Commands

```sh
misty setup [all|server|desktop|cloudflare]
misty doctor [all|server|desktop|cloudflare|release] [--json] [--fix]
misty check app|scripts|server|go-sizes|website|features|cli|all

misty env describe
misty env init dev
misty env set dev NAME     # reads the value from stdin
misty env check dev
misty env status dev

misty home generate [--destination PATH]
misty home check [--path PATH]

misty desktop dev [--profile NAME] [--route /spaces]
misty desktop build
misty desktop clean [--apply]
misty desktop icons sync

misty docs dev|build
misty website dev

misty server up [--no-build] [--verbose] [--gui]
misty server status|url|deploy
misty server logs [SERVICE] [--follow] [--tail 100]
misty server down [--volumes]
misty server worker generate-secrets
misty server r2 configure-cors [--apply]

misty release check|start|build|upload|verify|publish VERSION

misty tool NAME [ARGS...]
misty tasks
misty task NAME [ARGS...]
```

## Desktop development

`misty setup desktop` checks Node.js, runs `npm ci` and creates a `.env` pointing at the local API. `misty desktop dev` starts Vite and the Tauri shell; `npm run tauri -- dev` uses the same launcher, while a bare `npx tauri dev` bypasses it.

On macOS every native rebuild is signed with your Apple Development certificate, which gives Keychain a stable identity across rebuilds. If several certificates are installed, set `MISTY_DEV_SIGNING_IDENTITY` in `cli/.env/common.env` to the certificate name or SHA-1 from `security find-identity -v -p codesigning`. Release signing is separate.

`--profile NAME` runs an isolated copy with its own Tauri identifier (`com.misty.desktop.NAME`), app storage, Vite cache and Cargo output under `src-tauri/target/dev-profiles/NAME`. To test sync, run `misty desktop dev --profile dev1` and `--profile dev2` in two terminals and sign both in to the same account and vault.

The desktop app keeps its data in `~/.misty` on every platform (`MISTY_DATA_ROOT` moves it). `misty home generate` creates that layout without replacing existing files, and `misty home check` validates its permissions.

## Environment files

Development server settings live in private files under `server/.env/dev/`, and the CLI's own settings in `cli/.env/common.env`, `release.env` and `cloudflare.env`. Every file must be readable only by you. Each setting has exactly one owning file: `misty env describe` lists them, `misty env set` writes a value to the right file, and `misty env check` rejects unknown settings, duplicates, insecure files and missing required values. Files are created only when they hold a value. Shell exports override file values for Compose interpolation.

`misty setup server` generates the development keys and Worker secrets on first use and preserves them afterwards. Back up both halves of each key bundle together.

`misty server up` starts the development server containers (Postgres, the setup job, the API and its tunnel) and returns once they are healthy. They run no agent runtime and hold no model keys: agents and every model call run on the desktop, on its own keys ([docs/agents/runtime.md](../docs/agents/runtime.md)). Model key settings left in an older `integrations/ai.env` still load but are no longer read. Build output goes to `server/.misty/logs/`; `--verbose` prints it. `misty server down` keeps database volumes unless you pass `--volumes`. [server/README.md](../server/README.md) walks through the whole server setup.

## Checks

`misty check app` runs `npm run check`, the script tests, and format, clippy and tests for the desktop crate, Kiri and the helper services. `misty check cli` runs format, clippy and tests for this crate. `misty check all` runs every gate, including the server and website. The git hooks in `.githooks/` run the same suites on commit and push; enable them with `git config core.hooksPath .githooks`.

## Releases

Releases build, sign and upload from your computer; GitHub holds the source, the GHCR images and the release assets. Save the private settings in `cli/.env/release.env`, which shell values override:

| Setting | Purpose |
| --- | --- |
| `MISTY_RELEASE_WEB_URL` | Public HTTPS website URL compiled into the app |
| `TAURI_UPDATER_PUBLIC_KEY` | Public key matching the updater key |
| `TAURI_SIGNING_PRIVATE_KEY` | Absolute path to the local updater private key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for an encrypted key, if it has one |
| `APPLE_SIGNING_IDENTITY` | Installed Developer ID Application certificate, on macOS |
| `MISTY_NOTARY_KEYCHAIN_PROFILE` | Configured `notarytool` Keychain profile, on macOS |
| `WINDOWS_CERTIFICATE_THUMBPRINT` / `WINDOWS_TIMESTAMP_URL` | Local certificate and HTTPS timestamp service, on Windows |

Restore the updater key from your backup, then run `npm run release:keys` to check it against `release/trust.json` and save its path. Authenticate `gh`, install the release Rust targets and `cargo-cyclonedx`, and run `misty doctor release`.

```sh
misty release check
misty release start 0.2.0
misty release build 0.2.0 --upload
misty release verify 0.2.0
misty release publish 0.2.0
```

`start` runs every local check, tags the source and creates a draft. `build --upload` compiles, signs, notarizes and uploads verified assets to the draft. `verify` downloads the hosted files and checks their updater signatures, and `publish` makes the release public and latest, which is where installed apps look for `latest.json`. Published assets cannot be replaced, so a fix needs a new version.

A release has no built-in server: people choose Misty Cloud, their own server or browsing only in the setup wizard. Its Content Security Policy (`cli/src/release/config.rs`) therefore lets the app reach any `https:` and `wss:` origin, as development does, plus the agent runtime's live relay on `ws://127.0.0.1`; plain `http:` stays closed and only the app's own scripts run.

`start` targets the current OS unless you pass `--os macos`, `--os windows` or `--os macos,windows`. For both, build and upload the same commit on each OS, then verify and publish. macOS builds are universal and need both Apple Silicon and Intel Rust targets.

## Project tools

`misty tool NAME [ARGS...]` runs a project tool through the shared `.config/tooling.json` registry, the same one the npm scripts use, for example `misty tool vitest run src/features/files`. See [the tooling guide](../.config/README.md). `misty tasks` lists the TypeScript tasks in `cli/tasks/` that `misty task NAME` can run.
