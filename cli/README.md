# misty

`misty` is the development and release interface for the Misty workspace.
Desktop commands use Tauri's operating-system WebView and do not prepare or bundle a separate browser runtime.

## Install and start Misty

From the Misty repository root:

```sh
cargo install --path cli --locked
misty setup server
# Follow server/README.md for Cloudflare setup, then:
misty server up
misty server deploy
misty doctor server
misty setup desktop
misty desktop dev
```

On macOS, desktop development signs the native executable with your Apple
Development certificate on every native rebuild. This gives Keychain a stable
application identity instead of an ad-hoc signature that changes after linking.
Both `misty desktop dev` and `npm run tauri -- dev` use this launcher. Restart an
already running dev command after changing the launcher. Vite-only hot reload
does not restart or re-sign the native process.

Create an Apple Development certificate through Xcode if one is not installed.
If several certificates are available, set `MISTY_DEV_SIGNING_IDENTITY` to the
exact certificate name or SHA-1 from `security find-identity -v -p codesigning`.
Existing Keychain entries may request access once more when moving from the old
ad-hoc build to this identity; select **Always Allow** to remember it. On first
unlock, Misty migrates the old recovery and sync entries to encrypted local
storage and removes them only after committing and verifying their encrypted
copies. That migration can still prompt for the old entries. Afterwards there
is one Keychain device unlock key, cached in native memory for the process
lifetime. Recovery and sync roots remain separate, encrypted using AES-256-GCM
in `~/Library/Application Support/com.misty.desktop/device-keys/keys.sqlite`.
This device key and database are local only and shared across dev profiles;
neither is uploaded or included in workspace handoff. Removing a saved account
removes its encrypted roots while retaining the device key for other accounts.
If that key is missing or mismatched, Misty preserves the database and fails
closed rather than generating a replacement. The launcher does not loosen
Keychain access controls.
Release signing is unchanged. Direct `npx tauri dev` bypasses
the Misty launcher; use the commands above for stable desktop dev signing.

### Test device sync with two development profiles

Run these in separate terminals:

```sh
misty desktop dev --profile dev1
misty desktop dev --profile dev2
```

Sign in to the same account on the same server in both profiles, and connect
both to the existing sync vault. Each profile retains its own device ID and
local sync database across restarts; multiple windows within one profile remain
one device. Do not copy sync databases between profiles or reset IDs to test sync.
Their Vite dependency caches are separate, and Control lists the profile name
alongside its host and device ID.

Enable **Full sync** on both devices. Only the **Active** device publishes tab
and workspace changes. In the other profile, use **Control → Switch to This
device** to reverse direction. Website sign-in capture/restoration has its own
status: a sign-in warning does not mean the device IDs collided or that tab sync
is disconnected. Full sync off keeps that profile's workspace independent.

Start the website with:

```sh
misty website dev
```

Start the documentation site with:

```sh
misty docs dev
```

Built-in tools compile with Misty. Native workers are bundled during the desktop build.

The CLI discovers the current Misty checkout, including when run from a nested directory. Built-in tools and the CLI live in `src/features/` and `cli/`. Optional server and website repositories can live next to the checkout. Configure a fallback location with:

```sh
misty configure --workspace /path/to/misty-org
```

## Commands

```sh
misty doctor
misty setup
misty check tasks
misty check app
misty check server
misty check website
misty check tools
misty check cli
misty check all

misty env init dev
misty env init prod
misty env status dev
misty env check dev
misty env check prod

misty home generate
misty home generate --destination ./portable/.misty --source ~/.misty
misty home check


misty desktop dev
misty desktop dev --profile owner --route /spaces
misty desktop build
misty desktop clean
misty desktop clean --apply
misty desktop icons sync


misty docs dev
misty docs build
misty website dev

misty server up --detach
misty server url
misty server logs
misty server down
misty server prod check
misty server prod up
misty server prod logs
misty server prod down

misty release start 0.2.0
misty release build 0.2.0
misty release upload 0.2.0
misty release verify 0.2.0
misty release publish 0.2.0
```

Run `misty --help` or add `--help` after any command group for the complete
option reference.

## Misty home

Desktop Misty uses `~/.misty` on macOS, Linux, and Windows instead of Library
or AppData. Create the current layout on a device with:

```sh
misty home generate
misty home check
```

Generation is idempotent and never replaces existing files. To prepare a
portable seed from an existing installation, generate into a separate path:

```sh
misty home generate \
  --source ~/.misty \
  --destination ./portable/.misty
```

Only portable plugin web files are copied. Product assets ship inside the app.
Databases, credentials, note attachments, mounts, caches, logs, platform
binaries, and release keys stay device-local. Install the platform's Misty
application separately, then place the generated `.misty` directory in the
user's home.

The CLI stores its own workspace selection in `~/.misty/cli/config.toml` and
continues to read older platform-specific config locations during migration.
Development-only desktop profiles live under `~/.misty/cli/profiles` so they
cannot be mistaken for production application state.

## Setup and diagnostics

The backend lives in `server/`. Run the CLI from any directory inside this checkout.

| Command | Purpose |
| --- | --- |
| `misty setup server` | Create missing environment files and development keys. |
| `misty setup cloudflare --account ID --zone ID --hostname api.example.com` | Validate access and preview tunnel/DNS setup; add `--apply` to provision. |
| `misty setup desktop` | Create missing desktop API configuration and install frontend dependencies. |
| `misty env describe` | List registered variables and their owning files. |
| `misty env set dev NAME` | Read a value from stdin and save it to the correct private file. |
| `misty doctor server` | Check Docker, configuration, and running service health. |
| `misty doctor desktop` | Check desktop tool availability. |
| `misty doctor cloudflare` | Check Cloudflare access, the deployed Worker, and public API health. |
| `misty doctor release` | Run the existing release readiness checks. |
| `misty doctor server --fix` | Create missing local environment files and keys; preserve existing values. |
| `misty server status` | Show running services and completed setup jobs. |
| `misty server logs api --tail 100 --follow` | Follow bounded, service-specific logs. |
| `misty server deploy` | Explicitly deploy the development Worker. |

Doctor aggregates findings and exits nonzero if issues remain. `--json` produces structured findings for server, desktop, Cloudflare, and the default combined check. Release diagnostics retain their existing text output. Configuration checks and health checks do not exercise application workflows.

`misty server up` returns after readiness checks. Build output is retained in bounded private logs under `server/.misty/logs/`; failed stages print their final diagnostic lines. `--verbose` displays captured output after the build. Direct service logs remain available on request. `misty server down` preserves database volumes unless `--volumes` is explicitly supplied.

## Project tool configuration

`misty tool <name> [arguments]` uses the shared `.config/tooling.json` registry, as do the root npm scripts. Run it from any directory inside the checkout. Missing configurations produce an error instead of silently using defaults. For example, `misty tool vite build --mode desktop` and `misty tool vitest run src/features/files`. See [the tooling guide](../.config/README.md).
