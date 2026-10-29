# Cloudflare (optional)

Two small parts of Misty are Cloudflare Workers. Both deploy to your own Cloudflare account;
Misty has none you depend on. The server, the agent runtime and PostgreSQL never need Cloudflare
([self-hosting.md](self-hosting.md)).

| Worker | Code | Without it |
| --- | --- | --- |
| Collaboration | `server/apps/journal-collab` | Notes and drawings open read-only: this Worker is what saves them. Run it on Cloudflare or [on your own server](#run-it-on-your-own-server) |
| web-fetch | `server/apps/web-fetch` | Agents read pages only through one of your online devices |

You also need a Cloudflare account for a Cloudflare Tunnel or R2 storage, if you choose either.

## Account and token

Create a free Cloudflare account and enable a workers.dev subdomain (Workers & Pages → your
subdomain). Create an API token with Workers Scripts: Edit on that account. For a tunnel, add
Account and Zone Read, Cloudflare Tunnel: Edit and DNS: Edit for your zone. Save it without putting
it in your shell history:

```sh
misty env set prod CLOUDFLARE_API_TOKEN     # paste, then Ctrl-D
```

## Collaboration Worker

Live co-editing of notes and drawings runs in Durable Objects (y-partyserver). The Worker trusts
only tickets your API signs with an Ed25519 key that never leaves your server, and it calls back to
your API to save documents.

`misty env init prod` already generated the key pair and shared secrets: the server half in
`server/.env/prod/crypto/journal.env`, the Worker half in
`server/apps/journal-collab/.secrets/worker.prod.env`. Deploy:

```sh
cd server/apps/journal-collab && npm ci && cd -
misty server worker deploy --target production --dry-run
misty server worker deploy --target production
```

The deploy sets `MISTY_INTERNAL_API_BASE` from your `MISTY_PUBLIC_API_URL` and uploads the Worker's
secrets from that file; nothing secret goes into `wrangler.jsonc`. The Worker is named
`misty-journal-collab` (`MISTY_CLOUDFLARE_WORKER_NAME` to change it). Then tell the API where it is
and restart:

```sh
printf 'misty-journal-collab.YOUR-SUBDOMAIN.workers.dev' | misty env set prod PARTYKIT_HOST
misty server prod up
```

Collaboration is on exactly when `PARTYKIT_HOST` is set. Without it, notes and drawings are
read-only.

### Run it on your own server

The same Worker runs without Cloudflare in workerd, Cloudflare's open-source Workers runtime,
through the `collab` profile of `compose.prod.yml`. Its Durable Objects are stored on the
`collabdata` volume, and it calls the API inside the Compose network.

```sh
docker compose --file server/compose.prod.yml --profile collab up --detach collab
```

Run it through the CLI's environment like the rest of the stack (`misty server prod up` starts
only the default services). The service reads the Worker's secrets from
`server/apps/journal-collab/.secrets/worker.prod.env`, which `misty env init prod` generated, and
listens on `127.0.0.1:8787` (`MISTY_COLLAB_HOST_PORT`). Publish it over HTTPS on its own hostname,
for example with Caddy:

```text
collab.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Then set `PARTYKIT_HOST=collab.example.com` and run `misty server prod up`. The API and the
desktop both reach the Worker at `https://` and `wss://` on that hostname. This mode is meant for
a personal or small server: it runs the Worker through `wrangler dev`'s local runtime, not
Cloudflare's network.

## web-fetch Worker

`web.fetch` reads public pages for agent runs when none of your devices is online (scheduled runs,
email and Slack entries). It reads one public page without cookies, keeps nothing and never calls
your server. See [server/apps/web-fetch/README.md](../server/apps/web-fetch/README.md):

```sh
cd server/apps/web-fetch
npm ci
openssl rand -hex 32                        # the shared secret
npx wrangler secret put MISTY_WEB_FETCH_SECRET
npm run deploy
```

Give the API the Worker's address and the same secret, then restart:

```sh
printf 'https://misty-web-fetch.YOUR-SUBDOMAIN.workers.dev' | misty env set prod MISTY_WEB_FETCH_URL
misty env set prod MISTY_WEB_FETCH_SECRET
misty server prod up
```

## Tunnel

A Cloudflare Tunnel publishes the API over HTTPS without opening ports:

```sh
misty setup cloudflare --target prod --account ACCOUNT_ID --zone ZONE_ID --hostname misty.example.com
misty setup cloudflare --target prod --account ACCOUNT_ID --zone ZONE_ID --hostname misty.example.com --apply
```

The first command previews the tunnel and DNS route; `--apply` creates them and saves the tunnel
token and `MISTY_PUBLIC_API_URL`. Run `cloudflared` under a service manager on the host
([cli/README.md](../cli/README.md) has the command).

## R2

R2 is one choice for S3-compatible Library storage. Create a bucket and an R2 API token with Object
Read & Write on it, then set `MISTY_LIBRARY_BACKEND=s3`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY`
and `R2_SECRET_KEY`. `misty server r2 configure-cors --apply` allows your app origins. Backups can
use a second, locked bucket ([server/deploy/README.md](../server/deploy/README.md#backups)).
