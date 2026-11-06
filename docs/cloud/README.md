# Accounts on a shared server

Built October 31, 2026 (phase 3 of the Misty Pro plan). One Misty server can hold many people's
accounts with limits on what each uses. Misty Pro runs this way, and so can anyone who shares a
server. The open repository has no billing: a separate billing service, or the server's operator by
hand, drives accounts through the operator account API. Every limit is unlimited unless the
operator sets one, so a self-hosted server behaves as before.

All email is the server's (decided November 3, 2026), through Mailjet when it is set up
([self-hosting](../self-hosting.md#email)). The operator API always returns a setup key's sign-in
link and a Space invitation returns its link, so a server without Mailjet still works; one with it
also emails them, and closing notices. The alerts service records problems where the console and
the owner's app show them. Misty Pro needs Mailjet: the private misty-billing service sends no
email, and causes Misty Pro's (the website's "email me a sign-in link" page at
`https://mistysys.com/sign-in`, closing notices) through this API.

## Who can register

On a fresh server the first account registers itself and is the server's owner (the console marks
it). After that, a person can sign up, with a password or with Google, only while a Space invitation
to their email is open, or the operator account API makes their account. `GET /v1/instance` reports
`registration` as `open` before the first account and `invitation` after it. A refused sign-up
answers 403 `registration_closed`.

`MISTY_ALLOWED_EMAILS` in the server's env file is the other way to decide who's in: a list of emails
separated by commas or spaces. With it set, only those emails can make an account or sign in, invited
or not, by password or Google. Anyone else gets 403 `email_not_allowed`, and taking someone off the
list ends their session at its next refresh. The owner is always let in, so a mistake in the list
can't lock them out. A self-hosted account has no limits unless the operator sets some.

`MISTY_OPEN_SIGNUP=1` is how Misty Cloud runs, and it ignores the allowlist: anyone can make an account,
and `registration` stays `open`. It is off unless set, and Misty's own server sets it. An account made
this way starts with limits of zero, so it costs nothing until payment sets what it may use; the
server's first account is never held back. Until then sync tells that person the account has no
storage yet, and everything stays on their computer.

A server that sends email (Mailjet set up) makes a new password account only once its email is
confirmed. `POST /v1/register` answers 202 `{"status":"confirm_email"}` with no session, and the
sign-up waits in `pending_accounts` for 24 hours, with its password hash and no account or data. The
email links to the website's `/confirm-email#server=<host>&token=<token>`, which confirms as soon as
it opens. A mail scanner that only fetches the link confirms nothing, and a browser that reports
itself as automated (`navigator.webdriver`) gets a button instead; a scanner that runs the page and
hides that could still confirm. Whoever opens the link is signed in on the website when the server
is the website's own: the page calls `POST /v1/auth/confirm-email/sign-in {token}` through its API
address, so the cookies land where its sign-ins do, and the server answers as `POST /v1/login` does.
On any other server the website has no session to give, so the page posts the form to
`POST /v1/auth/confirm-email`, which makes the account and sends the browser back with
`?result=confirmed`, `expired`, `exists` or `failed`. An app that made the sign-up stays on its
waiting screen holding the password, since its sync keys come from it. Every 6 seconds it posts
`POST /v1/login {email, password, waiting: true}`, which opens no session and sends no email and
answers 202 `{"status":"confirm_email"}` until the account exists and 200 `{"status":"confirmed"}`
after, and then it signs in as usual. The newest sign-up for an email replaces the
last, so nobody can hold an address that isn't theirs, and one address gets at most one email every
2 minutes. Signing in with the right password while waiting answers 403 `email_not_confirmed` and
sends a new link. An email that gains an account meanwhile keeps that account, and the link signs
nobody in to it. The server's first
account is not held, and neither is an account from the operator API, whose setup key proves the
email.

## Misty accounts and Misty Pro

A Misty account is an account on Misty's own server, the one mistysys.com uses, and it is optional.
Misty Pro needs one. Anyone can self-host, with or without one: what an app uses depends only on which
server it points at. In the app, choosing Misty Pro moves the device to that server and opens its
usual sign-in, with Create account beside it (`mistyProServer()` in `src/api/deployment/`:
`dev-api.mistysys.com` in a development build). An account's credential derives from the server's
address, so the app and the website use the same one.

The website signs in on the same server, with a password or with Google. Its Google sign-in begins
with `POST /v1/auth/google {website: true}`, and the callback sends the browser to the website's
`/signin#google_code=<code>` instead of the app's completion page. The tab that began it holds the
polling token, and only the two together make a session (`POST /v1/auth/google/complete`).

An email has one account, and that account has one way in. A password sent for an email that signs
in with Google answers 409 `use_google` and says to use Google, at sign-in and at sign-up. Google
sign-in for an email that signs in with a password says to use the password; on the website it returns
to `/signin#google_error=password_account`, and in the app the same message shows there.

The website's settings and the app's Settings › Profile change the username
(`PUT /v1/me/username`), the one a Google account is given from its email included.

An account allowed no devices answers `devices_allowed: false` in `/me`, and `POST /devices` refuses
it with `no_devices_allowed`. The app says so once it's signed in: on Misty's server with a button to
the website's pricing page, elsewhere that the person who runs the server sets it up.

Buying goes through the website, signed in. `POST /v1/me/account-proof` answers a proof of the
signed-in account, good for 10 minutes. The page posts it to misty-billing's `POST /checkout`, which
reads the account with `POST /operator/v1/accounts/proof {proof}` (400 `account_proof_invalid` if it
is forged or expired), and starts a Stripe Checkout locked to that account's email. Without a proof
there is no checkout. Payment sets the limits of that account; no account or sign-in link is made. A new checkout closes
that account's earlier unpaid page at Stripe first, so two tabs can't pay twice.

Every sign-in ends the same way: the server issues its own signed JWTs, an access token and a refresh
token. The website holds them in HttpOnly cookies. The desktop app holds them in native code only
(`src-tauri/src/infra/account/session.rs`, saved through `misty-credential-store`) and sends
`Authorization: Bearer`. It asks with `X-Misty-Token-Transport: bearer` and gets them in
`X-Misty-Access-Token` and `X-Misty-Refresh-Token`, which the renderer never sees. The server agrees only
for a POST with no `Origin`, which a page can't send, and refreshes that way only when the refresh token
itself came in by bearer (`internal/platform/httpapi/auth_refresh.go`). A password is sent as typed over
TLS and the server hashes it. Google gives only the verified identity. Refreshes are serialized per server,
so no two requests present the same refresh token.

Someone already subscribed manages Misty Pro in the website's account settings, at
`/settings/subscription`: cancelling and keeping it happen there, with the same proof, and the card
and invoices open a Stripe page already signed in. Nobody goes through Stripe's emailed login. The
pricing page reads the same subscription for someone signed in, and offers Manage subscription, a
link to that page, in place of Get Misty Pro.

A suspended account gets no session, so it can't reach those settings. Signing in to one with the
right password or with Google answers 403 `account_suspended` with a `proof` beside it, good for
10 minutes, and still sets no cookies. A suspension from a failed payment is lifted by paying, so the
website's sign-in page takes that proof to billing and, if the plan's payment is what failed, offers
the Stripe card page. Any other suspension sees the usual message. A proof opens nothing on the
server itself.

## Invite links

`GET /v1/me/invite-code` answers the person's code, made the first time they ask, and the website's
Settings › Profile offers it as `https://mistysys.com/r/<code>`. `GET /v1/invites/{code}` needs no
account and answers `{"name": <username>}`, so that page can say who invited you; every code shares
one rate limit, 30 a minute, and a suspended or closing account's code answers 404
`invite_not_found`. A code only names its owner: it grants nothing, and nobody records who used it.
The referral credits that went with billing stay retired. Only the website offers a link, since
`/r/` looks codes up on Misty's own server.

## The operator account API

Mounted under `/operator/v1` only when `MISTY_OPERATOR_TOKEN` is set. Every request carries
`Authorization: Bearer <MISTY_OPERATOR_TOKEN>`; anything else gets 401 `operator_unauthorized`. The
token is compared in constant time.

| Request | Does |
| --- | --- |
| `POST /accounts/proof` `{proof}` | The account a signed-in person proved they hold (above). 400 `account_proof_invalid` when it is forged or expired |
| `POST /accounts` `{email, limits}` | Makes a password-less account and issues a setup key, returned as `setup_key` and `setup_link` in the account. 201 when it made one; 200 when the email already has an account, whose limits it then sets. A repeat issues (and returns) a key again only while the person hasn't signed in and holds no key that still works; otherwise the answer has no key |
| `GET /accounts?q=&limit=` | Lists accounts with limits and this period's use. `q` matches a fragment of an email or username |
| `GET /accounts?email=&limit=` | The account with exactly this email (compared in lower case, as stored), as a list of one or none. Takes the place of `q` |
| `GET /accounts/{id}` | One account, with its storage measured |
| `PATCH /accounts/{id}` `{limits, period_anchor}` | Sets the limits it names; ones it leaves out keep their value. `period_anchor` (RFC 3339) sets the billing period, `null` clears it, leaving it out keeps it |
| `POST /accounts/{id}/suspend` | Ends every session and refuses sign-in and API use. Data is kept |
| `POST /accounts/{id}/close` `{delete_after_days, keep_url}` | Makes the account read-only, stops its agents, and deletes it in 1 to 365 days (30 when left out). `keep_url` (https, optional) is where the closing emails say the person can keep the account. A repeat keeps the first date |
| `POST /accounts/{id}/resume` | Lifts a suspension, makes a closing account writable again and cancels its deletion |
| `POST /accounts/{id}/export` | The account's data and links to each note, drawing and file, as `POST /v1/me/export` answers, with no password. The links last 15 minutes. 503 `account_export_assets_unavailable` when the server can't sign them |
| `POST /accounts/{id}/setup-key` | Issues a new key, returned as `setup_key` and `setup_link`; earlier unused keys stop working. Works for an account that has signed in before: that sign-in may choose a new password, which is how a password is reset. A Google account answers 404 `account_not_found` (it signs in with Google) |

`limits` is `{storage_bytes, devices, app_actions_per_month}`. Each value is a
whole number of at least 0, or `null` for unlimited. `searches_per_month` is retired (web search
runs on each person's device, on their own key) and is ignored if sent. Storage is in bytes; plans count decimal
gigabytes (50 GB is 50,000,000,000). Answers carry `{"account": {...}}` with `id`, `email`,
`username`, `owner`, `suspended`, `delete_at` (null unless closing), `period_anchor`, `limits`,
`usage` (with `period_start`) and `setup` (`done`, `live_key`, `last_sent_at`: when the newest
key was issued). When the request issued a key, the account also carries `setup_key`
(`misty_setup_…`), `setup_link` (`https://mistysys.com/setup#server=<MISTY_HOSTNAME>&key=<key>`)
and, when this server is emailing it, `emailed: true`; otherwise they are absent. The key is stored
as a hash, so no later answer shows it again, and in plain text only in `email_outbox` until its
email goes.
Create also answers `created` beside `account`. A list answers `{"accounts": [...]}`, never with
keys. Errors are `invalid_request` (400), `account_not_found` (404, also for an account whose
deletion has begun) and `account_pending_deletion` (409: create for an email whose account is
being deleted; it is free again once the purge finishes).

## Closing an account

`close` is how an account ends without its owner deleting it, for example when a Misty Pro
subscription ends. Until its deletion date the account is read-only, so the person can still take
everything with them:

- It signs in, refreshes, reads everything and exports: the account export (`POST /me/export`),
  Library downloads, sync pulls and replays, Space chats, notes and drawings.
- Every change answers 403 `account_closing` with a `message` that names the deletion date and
  says subscribing again keeps the account, and with `delete_at`. That covers sync pushes,
  uploads, saving notes and drawings, Space changes, settings, device registration, agent runs and
  tool calls, and inbound email and Slack tasks.
- Closing cancels the agent work under way (personal and inbound invocations, and runs it asked for
  or its agents were doing). Its schedules wait instead of running, and come back on `resume`.
- `GET /me` carries `delete_at` while the account is closing, and `null` otherwise.

One guard decides for HTTP (`account_suspension.go` with `account_read_only.go`): GET, HEAD and
OPTIONS read, and so do a short list of POST routes: sign-in, sign-out and refresh, the export
and self-deletion, `/auth/handoff` (to subscribe again on the website), a setup key's redeem
and `PUT /me/password` (so a sign-in link still resets a forgotten password and the person can
export), the sync, live-update,
collaboration-room and Space-file (`nodes/{id}/resolve`) tickets, read receipts and a device's
heartbeat and channel ticket. Everything
else is refused before a handler runs. Writes that arrive another way are refused where they land:
the sync socket's record, favicon, workspace and claim writes in their transactions
(`db.RequireAccountWritableTx`, answered as `account_closing`; the device keeps the write queued
and offers it again ten minutes later), agent tool calls in the MCP server, new runs in
`CreateCreatorAgentRun`, mentions of the account's agents in `CreateAgentMemberRequest`, inbound
tasks, recaps and continuations in `AIActionAvailable`, and schedules in
`ClaimDueWorkflowSchedules`. Note and drawing tickets carry the `viewer` role, so the collaboration
Worker's rooms take no edits from it.

With Mailjet set up, the server emails the person that the account is read-only, how to export it
(Export on the app's notice, or the Library for files) and the deletion date, and warns them 3
days before it; `keep_url` adds where they can keep the account. Without Mailjet, telling them is the
operator's job. On the date, the account-deletion worker passes Spaces it owns that other people use pass to their
longest-standing member and the account goes through the same purge as a person deleting their own
account. `resume` before then cancels all of it.

Closing and suspension are separate. A suspended account that is also closing stays suspended: it
can't sign in, so it can't export. Billing suspends after 14 days unpaid and closes when the
subscription ends. An account closed before read-only closing existed (migration
`20271112000500`) kept the suspension closing gave it; resume it and close it again to make it
read-only.

## The purge

Deleting an account, by its owner after 30 days or by `close`, keeps one anonymous row (renamed,
without email or credentials) that content in Spaces other people still use stays attributed to,
as Privacy §10 promises. Everything else goes:

- Spaces it owned alone, the personal Space included: their notes and drawings (each
  collaboration room confirms its purge first), chats, Library files with every R2 object
  (originals, previews, renditions, exports, pending uploads), and their sync vaults.
- Its sync vaults in every Space, memory and embeddings, agent chats and their R2 attachments,
  agent workflows and schedules, devices, sessions, settings, usage, limits and setup keys.
- Its connected apps, deleted at Composio, and older provider credentials, revoked.

`internal/platform/db/account_purge.go` lists what is deleted and what is kept, with why.
`test/contract/postgres/account_purge_test.go` deletes a populated account and fails if any
table that references users still holds a row for it outside that list. An owner deleting a
Space also gets the purge now, 30 days later (`space_purge.go`); before, the Space stayed.

## Setup keys

`misty_setup_` and 32 lowercase base32 characters (160 random bits). Stored as SHA-256 hashes,
single use, valid for 7 days. The operator API answers with the key and its sign-in link,
`https://mistysys.com/setup#server=<MISTY_HOSTNAME>&key=<key>`. A server with Mailjet emails it, in
the same transaction as the key, so a key never exists without its email; otherwise the operator
passes it on (the console's **Sign-in link**). The website's static page reads the fragment in the browser, which never sends it
anywhere, and offers
`misty://setup?server=<host>&key=<key>`. Every server links there, self-hosted ones too; a server
serves API routes only.

`POST /v1/setup-keys/redeem {setup_key}` signs the account in exactly as `POST /v1/login` does,
with the same response body, cookies and session, and marks the key used. The app then registers
its device as it does after a login. A wrong key answers 401 `setup_key_invalid`; failures count
toward the sign-in lockout per client address, and the route has login's rate limit. The account
has no password until the app sets one with `PUT /v1/me/password`, which accepts an empty
`current_password` only while the account has none.

### Resetting a password

A setup key is the reset, emailed when the server has Mailjet: the redeem of
a Misty-password account also answers `password_reset_token`, which `PUT /v1/me/password
{reset_token, new_password, credential}` takes in place of the current password for 30 minutes
(`db.PasswordResetTTL`), once (stored by hash in `password_reset_tokens`, one per account). A
used, expired or other account's token answers 401 `password_reset_expired`. The change ends the
account's other sessions. The app's sign-in has a "Forgot your password?" link to
`https://mistysys.com/sign-in` (billing's page, which looks up any Misty account on that server with
`GET /accounts?email=` and issues a key, which the server emails; it also says that on another
server, the person who runs it makes the link). The old routes (`/auth/forgot`,
`/auth/reset*`) and email verification (`/auth/verify/start`, `/me/email/verify`) are gone; every
account counts as verified and `/me` answers `email_verified: true` for older apps.

### In the app

- The setup wizard's sign-in link step (`src/features/auth/setup/CloudScreen.tsx`, Use a sign-in
  link on its first step) takes a sign-in link, `https://mistysys.com/setup#server=<host>&key=<key>` (or an older server's own
  `https://<server>/setup#key=<key>`), or the server address and key typed apart.
  `misty://setup?server=<host>&key=<key>` from the website's setup page opens the wizard on that
  screen with both filled in (`src/app/routing/deepLinks.ts`, `src/features/auth/setupLinks.ts`).
  A link's server must be https and its key must have the setup-key shape, or the link is
  ignored; the key is held in memory only and never logged.
- Moving to another server signs out of the current one, so the new server takes the key first
  (`accountApi.redeemSetupKeyOn`). A key it refuses, or a server that doesn't answer, leaves the
  device signed in where it was.
- Right after a redeem the wizard asks a password account for a password (`ChoosePasswordScreen.tsx`,
  `accountSetFirstPassword` in `src/features/auth/store/accountPassword.ts`): the server gets
  `PUT /me/password {current_password: "", new_password: <password>}`, with the redeem's reset token
  when it has one. An account that hasn't set one yet can leave it for later. A Google account skips the
  step. This is also how an account made before passwords were sent as typed gets a new one: its stored
  hash can't be converted, so it takes one sign-in link.
- Without a reset token (the app restarted since), an account that turns out to hold a password
  already (the server refuses the empty current one) keeps it. A vault has its own password, so none
  of this touches sync.

## Limits

| Limit | Counted | Refused with |
| --- | --- | --- |
| Devices | Devices not removed, pending or added, when a new one registers (`RegisterUnifiedDevice`) | 409 `device_limit_reached` |
| Storage | Library, notes, messages and pending uploads, plus the encrypted sync vault's ciphertext | `owner_storage_quota_exceeded` on Library, note and drawing uploads; `storage_limit_reached` on sync record and favicon writes |
| App actions a period | Each `integration.execute` that runs (a replayed write isn't counted twice; a call Composio refused is given back) | Tool message starting `app_action_limit_reached:` |

App actions count per billing period. With a `period_anchor` a period starts on
the anchor's day each month (the 29th to 31st fall on a shorter month's last day); without one it
is the calendar month. Times are UTC, and a refused action names the day it renews.

Reads, downloads and deletions are never refused, so a full account can still open and free what
it has. Signed sync workspace changes (tabs and Spaces) are
measured but never refused, since refusing one would stall that device's signed change chain.

A suspended account gets 403 `account_suspended` from every signed-in route, from sign-in, setup
key redemption and session refresh, and from agent tool calls. Each server instance reloads the
suspended and closing lists every 15 seconds; the instance that suspends, closes or resumes applies
it at once, and suspending ends every session, so no access token outlives five minutes.

### What the app shows

Each code is shown in plain words with what to do next (`src/api/client/accountLimits.ts`, the
same wording in `src-tauri/src/infra/devices/http.rs`):

- `device_limit_reached` when this device registers (Settings › Devices): remove a device you no
  longer use, then try again.
- `storage_limit_reached` on sync writes: the sync status says storage is full and new changes
  wait on this device. The vault link holds uploads for ten minutes and clears the notice once a
  write goes through (`crates/browser-sync/src/vault/exchange.rs`).
  `owner_storage_quota_exceeded` on uploads uses the same words.
- `account_suspended` from any request: a notice stays over the window
  (`AccountSuspendedNotice`) until dismissed or the account is signed in again, and sign-in shows
  the same words.
- `account_closing`, from `/me`'s `delete_at` or a refused change: a calm notice
  (`AccountClosingNotice`) says the account is read-only until the date, when it is deleted, and
  that subscribing again keeps it. Its **Export** button asks for the Misty password or a fresh Google sign-in, calls `POST /me/export`, and saves
  `misty-account-<date>.json`: the account's data and a 15-minute link to each note, drawing and
  file (`src/features/auth/accountExport.ts`, `AccountExportDialog.tsx`). Device registration
  shows the same words (`src-tauri/src/infra/devices/http.rs`), and a refused sync write waits on
  the device (`crates/browser-sync`).
- `app_action_limit_reached:` in agent tool results: the conversation shows a plain line under
  the run's work (`src/features/agents/progress/usageLimits.ts`) when the step's error carries the
  code or the server's words; the agent runtime keeps the code in the error it reports
  (`visibleErrorMessage` in `src-tauri/services/agent-runtime`).

## The operator console

`misty-server/cmd/misty-console` (templ and htmx, loopback only; see the [server README](https://github.com/misty-org/misty-server/blob/main/README.md#operator-console)).

- **Customers** lists accounts with status (owner, awaiting setup, suspended, closing), devices
  against their limit, and for the selected account its use this period against every limit,
  when a closing account is deleted, its devices and sessions. With `MISTY_OPERATOR_TOKEN` in the
  console's environment it also sets limits (blank for unlimited), suspends, closes (30 days),
  resumes and makes a **Sign-in link** (a new setup key, shown once with a Copy button, to
  onboard someone or reset their password), all through the operator API. **Export data** downloads
  the whole account as a zip with its files inside, so it keeps working after the operator API's
  links expire. That's how to answer someone who emails for a copy of their data; each one is in
  the audit log.
- **Backups** lists the database dumps in `misty-server/.misty/backups` on that machine, and says it
  can't see copies kept elsewhere.
- **Logs** follows any service of the stack through docker compose on the console's machine. The
  server stack's console runs in a container without Docker, so there it says to use
  `docker compose logs` on the host.
- **Overview** is the status page: open alerts, health, traffic, database latency and recent
  operator actions.

## Code

| Where | What |
| --- | --- |
| `misty-server/internal/platform/db/account_*.go` | Limits, suspension, closing, setup keys, period use, limit checks, the purge and the operator account queries |
| `misty-server/internal/platform/db/space_purge.go` | The Space purge |
| `misty-server/internal/platform/db/migrations/20271110000000_cloud_accounts.sql` | `account_controls`, `account_setup_keys`, `account_usage` |
| `misty-server/internal/platform/db/migrations/20271112000000_account_closing_and_billing_periods.sql` | Closing columns, `period_anchor` and `misty_usage_period` |
| `misty-server/internal/platform/db/migrations/20271112000500_account_closing_read_only.sql` | Closing no longer implies suspension |
| `misty-server/internal/platform/httpapi/operator_*.go` | The operator API and its `limits` and `period_anchor` parsing |
| `misty-server/internal/platform/httpapi/account_closing.go`, `account_purge.go` | Deletion start; Composio, R2 and Space purge steps |
| `misty-server/internal/platform/httpapi/setup_keys.go`, `change_password.go`, `misty-server/internal/platform/db/password_reset_tokens.go` | Key format, redemption and the password reset it allows |
| `misty-server/internal/platform/httpapi/account_suspension.go` | The suspension and closing guard |
| `misty-server/internal/platform/httpapi/account_read_only.go`, `misty-server/internal/platform/db/account_read_only.go` | What a closing account may still do, and the write checks outside HTTP |
| `misty-server/internal/platform/httpapi/usage_limits.go` | App action metering |
| `misty-server/internal/platform/httpapi/registration.go` | Who may register |
| `misty-server/internal/platform/httpapi/email_confirmation.go`, `misty-server/internal/platform/db/pending_accounts.go` | Sign-ups waiting for their email to be confirmed |
| `misty-server/internal/browsersync/storage_limit.go` | The storage limit on sync writes |
| `misty-server/internal/console/customers*.go`, `operator_client.go`, `backups.go`, `logs.go` | Console pages |
