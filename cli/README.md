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

Native Cargo artifacts and intermediate files are isolated per profile under
`src-tauri/target/dev-profiles/<profile>`; bundled workers also have private build
directories. This prevents dev1 and dev2 from sharing build locks or overwriting
compiled profile configuration. Custom `CARGO_TARGET_DIR` (or
`CARGO_BUILD_TARGET_DIR`) and `CARGO_BUILD_BUILD_DIR` roots receive the same
`dev-profiles/<profile>` suffix. The first build of each profile creates its own
cache. Restart existing dev commands to pick up launcher changes; no CLI reinstall
is needed.

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

The CLI discovers the current Misty checkout, including when run from a nested directory. Built-in tools and the CLI live in `src/features/` and `cli/`. The backend lives in `server/`; the website can live in the sibling `misty-website/` checkout. Configure a fallback location with:

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
Development profiles select distinct Tauri identifiers (`com.misty.desktop.<profile>`)
and retain their own native application storage. The CLI does not create an unused
`~/.misty/cli/profiles` directory.

## Setup and diagnostics

The backend lives in `server/`. Run the CLI from any directory inside this checkout.

| Command | Purpose |
| --- | --- |
| `misty setup server` | Create development defaults and required development keys. |
| `misty setup cloudflare --account ID --zone ID --hostname api.example.com` | Validate access and preview tunnel/DNS setup; add `--apply` to provision. |
| `misty setup cloudflare --target prod --account ID --zone ID --hostname api.example.com` | Preview a separate production tunnel to the VPS host; add `--apply` to provision. |
| `misty setup desktop` | Create missing desktop API configuration and install frontend dependencies. |
| `misty env describe` | List registered variables and their owning files. |
| `misty env set dev NAME` | Read a value from stdin and save it to the correct private file. |
| `misty doctor server` | Check Docker, configuration, and running service health. |
| `misty doctor desktop` | Check desktop tool availability. |
| `misty doctor cloudflare` | Check Cloudflare access, the deployed Worker, and public API health. |
| `misty doctor release` | Run the existing release readiness checks. |

| `misty doctor server --fix` | Create missing local environment files and keys; preserve existing values. |
| `misty server status` | Show running services and unfinished or failed setup jobs. |
| `misty server logs api --tail 100 --follow` | Follow bounded, service-specific logs. |
| `misty server deploy` | Explicitly deploy the development Worker. |

Environment files are optional until they contain configuration. Setup and migration
do not create empty or comment-only placeholders, including under `cli/.env/`.
`misty env set` creates a setting's file on demand with private permissions.
`misty env check` still rejects missing required values, unknown settings, and
insecure existing files. Use `misty env describe` to find the file for an optional
integration before enabling it. Normal CLI commands also validate the files they load.

Server commands pass configured values to Compose interpolation through the process
environment, with shell values taking precedence there. Variables loaded only through
a service's `env_file` still come from that file; a shell export does not override
those container values. Compose skips absent optional files and does not implicitly
load a default `.env`.

Worker secret generation is first-use only. `misty setup server` preserves existing
development bundles and can restore a missing `.dev.vars` from its matching server
keys. `misty server worker generate-secrets --target production` creates a missing
production Journal configuration and room salt; it preserves an existing salt and
refuses to rotate configured keys. Back up both halves together. Environment migration
refuses to overwrite an existing scoped configuration file.

See [the complete CLI/environment audit](../server/docs/environment-audit.md) for
remaining production and release gaps. `misty tasks` lists executable entrypoints;
helper modules and tests are not commands.

Doctor aggregates findings and exits nonzero if issues remain. `--json` produces structured findings for server, desktop, Cloudflare, and the default combined check. Release diagnostics retain their existing text output. Configuration checks and health checks do not exercise application workflows.

`misty server up` returns after readiness checks. Build output is retained in bounded private logs under `server/.misty/logs/`; failed stages print their final diagnostic lines. `--verbose` displays captured output after the build. Direct service logs remain available on request. `misty server down` preserves database volumes unless `--volumes` is explicitly supplied.

### Production Cloudflare Tunnel

Run from the checkout on the VPS. The existing command defaults to `--target dev`.
Production uses only `server/.env/prod/` for its saved routing and connector token;
it does not initialize development secrets or configure/deploy a Worker.
Cloudflare API credentials can come from the shell, `cli/.env/cloudflare.env`,
or the selected target's `integrations/cloudflare.env`. Supply account and zone
IDs explicitly on first use if they are not already configured. Save a production
API token using `misty env set prod CLOUDFLARE_API_TOKEN` (value from stdin).

```sh
misty setup cloudflare --target prod \
  --account ACCOUNT_ID --zone ZONE_ID \
  --hostname api.mistysys.com --tunnel-name misty-prod
```

This previews the plan with read-only Cloudflare requests. Repeat with `--apply`
to create/reuse the tunnel, configure its ingress, create a proxied DNS CNAME,
and save the connector token and `MISTY_PUBLIC_API_URL=https://api.mistysys.com/v1`.
Later runs can use `misty setup cloudflare --target prod` with the saved values.
The default production name is `misty-prod-<hostname-with-hyphens>`; `--tunnel-name`
overrides it. Existing conflicting DNS records or ingress routes cause an error,
and a tunnel containing the development API origin cannot be reused for production.

The origin is `http://127.0.0.1:8081`, matching production Compose's loopback-only
API binding. To change it, save `MISTY_HOST_PORT` using `misty env set prod MISTY_HOST_PORT`
before provisioning and use that same port when starting production. Routing uses
the target's saved port, so avoid a different shell override when running Compose.
The tunnel forwards paths unchanged: `/v1` belongs in the public API URL, not in
the tunnel origin. No Nginx is required for this API route.

Provisioning does not start the connector. Install `cloudflared` on the VPS host,
then start the API with `misty server prod up`. For an initial connector check,
run this from the checkout in a separate terminal:

```sh
(
  . server/.env/prod/integrations/cloudflare.env
  export TUNNEL_TOKEN="$CLOUDFLARE_TUNNEL_TOKEN"
  exec cloudflared tunnel --no-autoupdate run
)
```

[`TUNNEL_TOKEN`](https://developers.cloudflare.com/tunnel/reference/run-parameters/#token)
keeps the connector token out of command arguments. Run the connector persistently
under a service manager before relying on it in production; closing this terminal
stops this foreground check. The connector must run on the VPS host to reach this
loopback origin. An ordinary isolated Docker container cannot use this origin.
Verify with `curl --fail https://api.mistysys.com/health`; `misty doctor cloudflare`
currently checks development. Production collaboration Worker deployment remains
separate from API tunnel provisioning.

## Project tool configuration

`misty tool <name> [arguments]` uses the shared `.config/tooling.json` registry, as do the root npm scripts. Run it from any directory inside the checkout. Missing configurations produce an error instead of silently using defaults. For example, `misty tool vite build --mode desktop` and `misty tool vitest run src/features/files`. See [the tooling guide](../.config/README.md).
