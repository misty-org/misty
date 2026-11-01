# Cloudflare

Every Misty server runs on your own Cloudflare account; Misty has none you depend on. The setup
container of `server/compose.yml` provisions all of it through the Cloudflare API on each start,
reusing what it made before by name ([self-hosting.md](self-hosting.md)). You give it a token, an
account and a zone in `server/.env/cloudflare.env`, and never run Wrangler or the `misty` CLI.

| Part | Name (from `MISTY_HOSTNAME`, dots as dashes) | What it does |
| --- | --- | --- |
| Tunnel | `misty-<host>` | Publishes the API at `https://MISTY_HOSTNAME` with no open ports; `cloudflared` in the stack connects it |
| DNS record | `MISTY_HOSTNAME` | A proxied CNAME to the tunnel |
| Library bucket | `misty-<host>-library` | Uploads, attachments, avatars and images in notes and drawings |
| Backup bucket | `misty-<host>-backups` | Encrypted nightly database dumps, under a 30-day lock |
| Two R2 tokens | `misty-<host> library`, `misty-<host> backups` | One bucket each; the API holds only the Library one |
| Collaboration Worker | `misty-<host>-collab` | Saves and co-edits notes and drawings (Durable Objects) |
| web-fetch Worker | `misty-<host>-web-fetch` | Reads one public page for agent runs when no device is online |

A hostname longer than 40 characters is shortened in these names.

## API token

Create an account API token (My Profile → API Tokens, or Manage Account → API Tokens) with:

| Scope | Permission |
| --- | --- |
| Account | Cloudflare Tunnel: Edit |
| Account | Workers Scripts: Edit |
| Account | Workers R2 Storage: Edit |
| Account | Account API Tokens: Edit (setup creates the two bucket-scoped R2 tokens) |
| Zone (your zone) | Zone: Read |
| Zone (your zone) | DNS: Edit |

Turn on a workers.dev subdomain for the account (Workers & Pages → Settings) before the first
start; setup stops and says so otherwise.

## What setup does each start

1. Checks that the zone belongs to the account and holds `MISTY_HOSTNAME`.
2. Finds or creates the remotely managed tunnel, sets its one route
   (`MISTY_HOSTNAME` → the API container) and saves the connector token for `cloudflared`.
3. Creates the CNAME if there is none, and turns on its proxy if it is off. A record for the
   hostname that points anywhere else is yours: setup stops without changing it.
4. Creates the buckets if they are missing, sets the Library bucket's CORS rule for the desktop
   app (and `MISTY_ALLOWED_ORIGINS`), and the backup bucket's lock and expiry rules.
5. Keeps each bucket's token while it exists. If its value was lost, setup rolls that token's
   value instead of creating another.
6. Uploads each Worker when its code, settings or secrets changed since the last upload, with the
   API's address and the Worker's secrets as bindings, and keeps it on workers.dev. The
   collaboration Worker gets only the public half of the ticket key; the private half never leaves
   the server.

When Cloudflare cannot be reached on a start whose settings already worked before, setup logs a
warning and the stack starts on what it recorded, so an outage never keeps the server down.

## Collaboration Worker

Live co-editing of notes and drawings runs in Durable Objects (y-partyserver). The Worker trusts
only tickets the API signs with an Ed25519 key that never leaves the server, and it calls back to
the API to save documents. Notes and drawings are always saved through it; there is no read-only
mode.

## web-fetch Worker

`web.fetch` reads public pages for agent runs when none of your devices is online (scheduled runs,
email and Slack entries). It reads one public page without cookies, keeps nothing and never calls
your server. See [server/apps/web-fetch/README.md](../server/apps/web-fetch/README.md).

## Development

The development stack (`server/compose.dev.yml`) uses its own tunnel and collaboration Worker,
which `misty setup cloudflare` and `misty server deploy` provision ([server/README.md](../server/README.md)).
The setup container is tested against a fake Cloudflare API (`server/deploy/setup/fakecloudflare`),
never the real one.
