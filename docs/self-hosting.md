# Self-hosting

Misty is open source (MIT) and has no hosted service. The browser works without any server:
signed out, it keeps everything on your computer ([browser/no-account.md](browser/no-account.md)).
Sync between devices, Spaces and agents need a Misty server, and you run that server yourself on
your own computer, a VPS, or any platform that runs Docker containers.

Models run on your own keys. Each device keeps its keys and model choices in Settings → Models
([byok.md](byok.md)). There is no billing, no plan and no usage limit beyond what your provider
charges you.

## What runs where

| Part | Where | Needed for |
| --- | --- | --- |
| Desktop app | Your computer | Everything; browsing needs nothing else |
| Go API (`server/`) | Your server, Docker | Accounts, encrypted sync, Spaces, files, agent tools |
| Agent runtime (`server/apps/agent-runtime`) | Your server, Docker | Agent runs and every model call |
| PostgreSQL with pgvector | Your server, Docker | The API's data and the runtime's workflow database |
| Collaboration Worker (`server/apps/journal-collab`) | Your Cloudflare account, or your server through the `collab` profile | Saving and co-editing notes and drawings |
| web-fetch Worker (`server/apps/web-fetch`) | Your Cloudflare account, optional | `web.fetch` for runs with no device online |

Without the collaboration Worker, notes and drawings are read-only, so most servers want it: on
Cloudflare or on the same host ([cloudflare.md](cloudflare.md#run-it-on-your-own-server)). Without
the web-fetch Worker, agents read pages through your online devices only.

## Requirements

- A Linux or macOS host with Docker Engine and Compose v2. 2 CPU cores and 4 GB of memory are
  enough for one person; the agent runtime holds most of the memory.
- Git and Rust (through rustup) to build the `misty` CLI, which generates the server's keys and
  runs the stack. Everything else builds inside containers.
- An HTTPS address for the API if any device other than the host connects to it: a domain with a
  reverse proxy (Caddy, nginx, Traefik), a Cloudflare Tunnel, or Tailscale serve.

## Install

```sh
git clone https://github.com/misty-org/misty.git
cd misty
cargo install --path cli --locked
misty env init prod
```

`misty env init prod` writes private files under `server/.env/prod/` with fresh database
passwords, signing keys, the agent runtime secret, device keys and collaboration keys. Running it
again keeps existing values. Keep an encrypted copy of `server/.env/prod/` somewhere safe: losing
the signing keys signs every device out.

Set your public API address (it ends in `/v1`):

```sh
printf 'https://misty.example.com/v1' | misty env set prod MISTY_PUBLIC_API_URL
misty env status prod
misty server prod check
```

`misty env set` reads the value from stdin so it never lands in your shell history.
`misty env status` shows which names are still missing, never their values.

## Start

```sh
misty server prod up
misty server prod logs
```

`up` builds the API and agent runtime images from your checkout, applies the database
migrations, sets up the workflow database and starts everything. The API listens on
`127.0.0.1:8081` (`MISTY_HOST_PORT`); PostgreSQL and the agent runtime have no host ports. Check
`http://127.0.0.1:8081/health`, then publish the API over HTTPS.

To update, `git pull` and run `misty server prod up` again. Migrations run on every start.

## Publish the API over HTTPS

Any reverse proxy that forwards to `127.0.0.1:8081` works. With Caddy, which gets certificates on
its own:

```text
misty.example.com {
    reverse_proxy 127.0.0.1:8081
}
```

Set `TRUST_PROXY_HEADERS=true` when a proxy sits in front, so rate limits see the real client
address. A Cloudflare Tunnel works too and needs no open ports:
`misty setup cloudflare --target prod --account ACCOUNT_ID --zone ZONE_ID --hostname misty.example.com --apply`
([cloudflare.md](cloudflare.md)).

## Connect the desktop app

Point the app at your server with `MISTY_PUBLIC_API_URL` when you build it (`.env` at the
repository root, see the [README](../README.md#get-started)), then create the first account from
the app's sign-in screen. Add your model keys in Settings → Models on each device.

## Storage

Library files (uploads, attachments, renditions) live on the `librarydata` volume under
`/var/lib/misty/library` by default. To use S3-compatible storage instead (R2, S3, MinIO), set
`MISTY_LIBRARY_BACKEND=s3` with `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY` and `R2_SECRET_KEY`.

## Optional settings

Set each with `misty env set prod NAME`; `misty env describe` lists every name and its file.

| Setting | What it turns on |
| --- | --- |
| `MISTY_AGENT_MODEL` and runtime keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) | Server-side models for every account on this server, used when a device sends no keys ([byok.md](byok.md#server-keys)) |
| `MISTY_SERPER_API_KEY` | `web.search` for agents (serper.dev) |
| `MAILJET_*` | Email for password resets and verification |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google ([server/docs/google-sign-in.md](../server/docs/google-sign-in.md)) |
| `MISTY_COMPOSIO_API_KEY` | Connected apps through your own Composio project |
| `ELEVENLABS_API_KEY`, `SONIOX_API_KEY` | Server-side voice and transcription |
| `MISTY_WEB_FETCH_URL`, `MISTY_WEB_FETCH_SECRET` | Page reading with no device online ([cloudflare.md](cloudflare.md#web-fetch-worker)) |
| `MISTY_BACKUP_*` | Nightly encrypted backups ([server/deploy/README.md](../server/deploy/README.md#backups)) |

## Without the CLI

`server/compose.prod.yml` is a plain Compose file. The CLI only loads the files under
`server/.env/prod/` into the environment before calling `docker compose`, and checks them first.
If you manage configuration another way (a platform's secret store, Kubernetes), provide the same
variables to the `api` and `agent-runtime` services; `misty env describe` is the list.

## Development stack

Working on Misty itself uses a different stack (`misty server up`, `server/compose.dev.yml`),
which expects a Cloudflare tunnel and the collaboration Worker. See [server/README.md](../server/README.md).
