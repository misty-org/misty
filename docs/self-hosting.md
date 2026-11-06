# Self-hosting

Misty is open source under the AGPL-3.0. The browser works without any server: signed out, it
keeps everything on your computer ([browser/no-account.md](browser/no-account.md)). Sync between
devices, Spaces and agents need a Misty server, and you run that server yourself from one Compose
file, `misty-server/compose.yml`.

A server never calls a model and never searches the web. Agents, every model call and web search
run on your desktop, on the model keys and the search key each device keeps in Settings → Models
([byok.md](byok.md)), so agents need one of your desktops online.

Nothing on a server is optional. Every server uses Cloudflare (a Tunnel for its address, R2 for
files and backups, and a Worker), Composio for connected apps and Google sign-in. You bring an
account and key for each; the server never runs without one.

Email is the one optional part. With [Mailjet set up](#email), the server sends sign-in links,
Space invitations and closing notices. Without it, Misty gives you a link to pass on: a sign-in
link for a new account or a forgotten password (the console's **Sign-in link**), and an invitation
link when someone is invited to a Space. Either way, problems the `alerts` service finds show in
the console and in the app of the server's owner.

## What runs where

| Part | Where | What it does |
| --- | --- | --- |
| Desktop app | Your computer | The browser, and every agent and model call |
| `setup` | Your server, once per start | Generates secrets, checks them against your data, provisions Cloudflare |
| `postgres` | Your server | The API's data (PostgreSQL with pgvector) |
| `migrate` | Your server, once per start | Applies database migrations and the API role's grants |
| `api` | Your server | Accounts, encrypted sync, Spaces, files, agent tools |
| `cloudflared` | Your server | Publishes the API at `https://MISTY_HOSTNAME` through the Tunnel |
| `backups` | Your server | Encrypted database backups to R2 every night at 03:00 UTC |
| `alerts` | Your server | Records an open alert when the server is down or failing, and clears it when it recovers |
| `console` | Your server, `127.0.0.1:7070` only | The operator console |
| Collaboration Worker (`misty-server/services/journal-collab`) | Your Cloudflare account | Saves and co-edits notes and drawings |

The setup container deploys the Worker on every start that changes it. You never run
Wrangler or the `misty` CLI to deploy; the CLI is for working on Misty itself.

## Requirements

- A VPS or other always-on Linux or macOS computer with Docker Engine and Compose v2. 2 CPU cores
  and 2 GB of memory are enough for a small server.
- Git, to get the code. Everything else builds inside the containers.
- A domain on Cloudflare, and accounts with Composio and Google Cloud.
- The app's release builds only connect to a server on an https domain: never plain http, an IP
  address, localhost or a domain that resolves to a private address. Only a development build
  (`npm run dev`) takes those. A Cloudflare Tunnel's hostname resolves to Cloudflare, so it passes.

## Configure

Clone the repository and create the four files under `~/.misty/server/prod/`, with everything else
Misty keeps on this computer. They stay outside the repository; Misty never commits an env file,
not even an example. Each is a plain `NAME=value` file, readable only by you. Set `MISTY_ENV_DIR`
in your shell to keep them in another folder. A server set up with a `.env/` folder in its checkout needs its files
moved there.

```sh
git clone https://github.com/misty-org/misty-server.git
cd misty-server
mkdir -p -m 700 ~/.misty/server/prod
```

### misty.env

| Name | Value |
| --- | --- |
| `MISTY_HOSTNAME` | The server's public hostname, such as `cloud.misty.example`. The API is `https://MISTY_HOSTNAME/v1` |
| `MISTY_INSTANCE_NAME` | Optional: the name devices show for this server (default `Misty`) |
| `MISTY_ALLOWED_ORIGINS` | Optional: comma-separated `https://` origins of websites you run against this API |

### cloudflare.env

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | An API token with the permissions in [cloudflare.md](cloudflare.md#api-token) |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (32 hexadecimal characters) |
| `CLOUDFLARE_ZONE_ID` | The ID of the zone `MISTY_HOSTNAME` belongs to |

Turn on a workers.dev subdomain for the account first (Workers & Pages → Settings).

### composio.env

| Name | Value |
| --- | --- |
| `MISTY_COMPOSIO_API_KEY` | Your Composio project's API key ([misty-server/deploy/composio/README.md](https://github.com/misty-org/misty-server/blob/main/deploy/composio/README.md)) |

### google.env

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth client ID of a Web application client |
| `GOOGLE_CLIENT_SECRET` | Its client secret |

Add `https://MISTY_HOSTNAME/v1/auth/google/callback` as an authorized redirect URI
([misty-server/docs/google-sign-in.md](https://github.com/misty-org/misty-server/blob/main/docs/google-sign-in.md)).

There are no other settings to make. Model keys never go on the server: the API refuses to start
if it finds one. Neither does a search key: each person adds one on their desktop for web search
([byok.md](byok.md#web-search)). A `search.env` from an earlier server is no longer read and can be
deleted.

### mailjet.env (optional)

| Name | Value |
| --- | --- |
| `MAILJET_API_KEY` | Your Mailjet API key |
| `MAILJET_SECRET_KEY` | Its secret key |
| `MAILJET_FROM_EMAIL` | The address email comes from, verified in Mailjet |
| `MAILJET_FROM_NAME` | Optional: the name it comes from (default `Misty`) |

Leave this file out to send no email ([Email](#email)).

## Start

```sh
docker compose up -d --build
docker compose ps
```

On the first start the setup container generates every secret into the `secrets` volume (database
passwords, signing keys, device and collaboration keys, the agent runtime secret the server derives
per-run keys from, the operator token, the backup key), creates or reuses the Cloudflare Tunnel and
the DNS record for `MISTY_HOSTNAME`, the two R2 buckets and their credentials, and deploys the
Worker. Every later start finds the same resources by name and never replaces a secret. Watch it
with `docker compose logs setup`.

The API answers at `https://MISTY_HOSTNAME/health` once the tunnel connects, and on this computer
at `http://127.0.0.1:8081/health` (`MISTY_HOST_PORT` in your shell changes the port). To update,
`git pull` and run `docker compose up -d --build` again; migrations run on every start.

## Secrets

The `secrets` volume is the only copy of the server's secrets. Losing it while keeping the
database is the one state the stack refuses: setup stops with `secrets lost` instead of generating
new keys that would sign everyone out and leave encrypted data unreadable. Keep a copy somewhere
off the server:

```sh
docker compose run --rm --no-deps --entrypoint tar setup -C /run/misty/secrets -czf - . > misty-secrets.tgz
```

Store that file encrypted (a password manager or `age`), never next to the server.

Rotate a secret with its previous value kept valid, then restart the stack:

```sh
docker compose run --rm setup rotate MISTY_AUTH_SIGNING_KEY
docker compose up -d --force-recreate
docker compose run --rm setup retire MISTY_AUTH_SIGNING_KEY   # later, once old sessions expired
```

| Rotates | With |
| --- | --- |
| `MISTY_AUTH_SIGNING_KEY`, `MISTY_AGENT_RUNTIME_CONTROL_SECRET`, `MISTY_OPERATOR_TOKEN`, `JOURNAL_COLLAB_CONTROL_SECRET`, `JOURNAL_COLLAB_PROJECTION_SECRET` | The old value in its `*_PREVIOUS` slot |
| `MISTY_DEVICE_TICKET_PRIVATE_KEY`, `JOURNAL_COLLAB_TICKET_PRIVATE_KEY` | The old public key in `MISTY_DEVICE_TICKET_PREVIOUS_PUBLIC_KEYS` or `JOURNAL_COLLAB_TICKET_PUBLIC_KEY_PREVIOUS` |
| `DB_PASSWORD`, `MISTY_METRICS_TOKEN` | Nothing: the next start applies the new value everywhere |

Secrets that protect stored data never rotate: the database superuser password, the Space link
key, the device pairing pepper, the collaboration room salt, the document key and the backup key.
Rotation never touches data; data is removed only with the whole stack
(`docker compose down --volumes`, plus the R2 buckets).

## Accounts

The first account created on a fresh server registers itself from the app's sign-in screen and
owns the server. After that, a new account comes only from an invitation: someone on the server
invites an email address to a Space, and that address can then create its account. Accounts on your
server have no limits unless you set some. You don't need a Misty account to run your own server.

To decide exactly who's in, list them in `misty.env`:

```
MISTY_ALLOWED_EMAILS=ana@example.com,sam@example.com
```

With a list, only those emails can make an account or sign in, invited or not. Taking someone off it
ends their session within minutes, once the server restarts with the new list. The owner is always let in.

`MISTY_OPEN_SIGNUP=1` is how Misty Cloud runs, and it ignores the list: anyone can make an account,
starting with limits of zero until you set what it may use.

With [email](#email) set up, a new password account after the first exists only once its email is
confirmed. An email has one account: signing in the other way says which way to use.

## Email

With `mailjet.env` in place, the server emails:

| Email | When |
| --- | --- |
| A new account's sign-in link | An account is made through the operator API, or the console's **Sign-in link** for one that hasn't signed in |
| A sign-in link | The console's **Sign-in link**, for an account that has signed in before. It also lets the person set a new password |
| A Space invitation | Someone is invited to a Space, or an invitation gets a new link |
| An email confirmation link | Someone signs up with a password. It works for 24 hours |
| Read-only notice and deletion warning | An account is closed: a notice now, and a warning 3 days before it is deleted |

A sign-in or invitation link is still shown to whoever asked for it. Each email is stored before it is sent and retried
for 7 days, from a minute apart up to an hour. A key or link is kept in the database, in
`email_outbox`, only until its email goes, and sent rows are deleted after 30 days. In Mailjet,
verify the sender address and add its SPF and DKIM records, or mail may not arrive. Restart the API
after changing the file (`docker compose up -d api`). If only some of the required values are set,
the server sends nothing and says why in its log.

## Backups

The `backups` service dumps the database every night at 03:00 UTC, encrypts the dump to the
server's backup key with [age](https://age-encryption.org) and uploads it to the
`misty-…-backups` bucket. That bucket has a 30-day lock, so no credential on the server can delete
or overwrite a backup in that time, and backups expire a day after their lock ends.

```sh
docker compose exec backups misty-setup backup --now   # one now
docker compose exec backups misty-setup backups        # list them
docker compose run --rm --no-deps backups backup-key   # the age key, to keep a copy off the server
```

Restore onto a running stack:

```sh
docker compose stop api
docker compose exec backups misty-setup restore latest   # or a name from the list
docker compose up -d
```

Practise a restore on a spare server: a backup that has never been restored is not yet a backup.

## Alerts

The `alerts` service checks the server every minute. When one of these is seen on two checks in a
row it records an open alert in the database (`server_alerts`), and it removes the alert when the
problem clears:

- the API doesn't answer `/health`, or a critical check (database, Library storage, realtime)
  fails;
- 5% or more of the last minute's requests (at least 20) failed with a server error, from
  `/metrics`;
- the database volume has less than 10% of its space free;
- no backup was made in the last 26 hours (checked hourly).

Open alerts show on the console's Overview and, as a quiet notice, in the Misty app of the
server's owner (its first account), which reads them from `GET /v1/server/alerts` (owner only).
Nothing is emailed. An alert open when the service restarts still clears when its problem has
gone. It runs on the server it watches, so it can't report the whole machine going away, and an
alert can't be recorded while the database itself is down (the console's health checks still show
it); an outside uptime check on `https://MISTY_HOSTNAME/health` covers that. `docker compose logs
alerts` shows what it found.

## Operator console

The console listens on `127.0.0.1:7070` on the server only (`MISTY_CONSOLE_PORT` changes the
port). Its sign-in link is in its log:

```sh
docker compose logs console
```

From another computer, forward the port over SSH (`ssh -L 7070:127.0.0.1:7070 you@server`).

## Connect the desktop app

Open Misty, choose My own server in the setup wizard and enter `https://MISTY_HOSTNAME`, then
create the first account. Each device picks its models in Settings → Models; the server never
needs model keys ([byok.md](byok.md)).

The first account to register on a fresh server is its owner. After that, a person can sign up
only with an open Space invitation to their email from someone who already has an account (the
invite dialog gives the inviter a link to send), or through the operator account API
([cloud/](cloud/README.md)), which the console uses. Customers › **Sign-in link** in the console
makes a single-use link, `https://mistysys.com/setup#server=MISTY_HOSTNAME&key=…`, valid for seven
days, that you send to the person yourself unless the server [sends email](#email): a static page reads the server and key in the browser
and opens Misty; the server itself serves only its API. The same link resets a forgotten password:
it signs the person in and asks for a new one, and Misty's sign-in tells people who forgot theirs
to ask you for a link. The operator API also closes an account: it becomes read-only and is
deleted after the days you set unless resumed; tell the person yourself. The setup container
generates the API's `MISTY_OPERATOR_TOKEN`. With [Mailjet set up](#email), the server emails the
link and the closing notices for you. There is no setting for any of this. Existing
accounts always sign in.

## Changing the server

The AGPL covers servers. If you change Misty's server or Workers and other people use your server,
you must offer them the source of your changed version under the AGPL, for example with a link on
your sign-in page or in your server's description. Running Misty unchanged, or changed only for
yourself, needs nothing extra.

## Development stack

Working on Misty itself uses a different stack (`misty server up`, `misty-server/compose.dev.yml`),
driven by the development-only `misty` CLI. See [misty-server/README.md](https://github.com/misty-org/misty-server/blob/main/README.md).
`misty-server/deploy/setup/stack-test.sh` runs this production stack against a fake Cloudflare API on
free ports and removes everything it made.
