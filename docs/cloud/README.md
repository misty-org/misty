# Accounts on a shared server

Built October 31, 2026 (phase 3 of the Misty Cloud plan). One Misty server can hold many people's
accounts with limits on what each uses. Misty Cloud runs this way, and so can anyone who shares a
server. The open repository has no billing: a separate billing service, or the server's operator by
hand, drives accounts through the operator account API. Every limit is unlimited unless the
operator sets one, so a self-hosted server behaves as before.

The open server sends no email (decided October 31, 2026). It answers with links instead: the
operator API returns a setup key's sign-in link, a Space invitation returns its link, and the
alerts service records problems where the console and the owner's app show them. Misty Cloud's
emails (the welcome email with its sign-in link, the website's "email me a sign-in link" page at
`https://mistysys.com/sign-in`, closing notices) are sent by the private misty-billing service,
which gets the links from this API.

## Who can register

There is no setting. On a fresh server the first account registers itself and is the server's
owner (the console marks it). After that, a person can sign up, with a password or with Google,
only while a Space invitation to their email is open, or the operator account API makes their
account. `GET /v1/instance` reports `registration` as `open` before the first account and
`invitation` after it. A refused sign-up answers 403 `registration_closed`.

## The operator account API

Mounted under `/operator/v1` only when `MISTY_OPERATOR_TOKEN` is set. Every request carries
`Authorization: Bearer <MISTY_OPERATOR_TOKEN>`; anything else gets 401 `operator_unauthorized`. The
token is compared in constant time.

| Request | Does |
| --- | --- |
| `POST /accounts` `{email, limits}` | Makes a password-less account and issues a setup key, returned as `setup_key` and `setup_link` in the account. 201 when it made one; 200 when the email already has an account, whose limits it then sets. A repeat issues (and returns) a key again only while the person hasn't signed in and holds no key that still works; otherwise the answer has no key |
| `GET /accounts?q=&limit=` | Lists accounts with limits and this period's use. `q` matches a fragment of an email or username |
| `GET /accounts?email=&limit=` | The account with exactly this email (compared in lower case, as stored), as a list of one or none. Takes the place of `q` |
| `GET /accounts/{id}` | One account, with its storage measured |
| `PATCH /accounts/{id}` `{limits, period_anchor}` | Sets the limits it names; ones it leaves out keep their value. `period_anchor` (RFC 3339) sets the billing period, `null` clears it, leaving it out keeps it |
| `POST /accounts/{id}/suspend` | Ends every session and refuses sign-in and API use. Data is kept |
| `POST /accounts/{id}/close` `{delete_after_days}` | Makes the account read-only, stops its agents, and deletes it in 1 to 365 days (30 when left out). Sends nothing; telling the person is the caller's job. A repeat keeps the first date |
| `POST /accounts/{id}/resume` | Lifts a suspension, makes a closing account writable again and cancels its deletion |
| `POST /accounts/{id}/setup-key` | Issues a new key, returned as `setup_key` and `setup_link`; earlier unused keys stop working. Works for an account that has signed in before: that sign-in may choose a new password, which is how a password is reset. A Google account answers 404 `account_not_found` (it signs in with Google) |

`limits` is `{storage_bytes, devices, app_actions_per_month}`. Each value is a
whole number of at least 0, or `null` for unlimited. `searches_per_month` is retired (web search
runs on each person's device, on their own key) and is ignored if sent. Storage is in bytes; plans count decimal
gigabytes (50 GB is 50,000,000,000). Answers carry `{"account": {...}}` with `id`, `email`,
`username`, `owner`, `suspended`, `delete_at` (null unless closing), `period_anchor`, `limits`,
`usage` (with `period_start`) and `setup` (`done`, `live_key`, `last_sent_at`: when the newest
key was issued). When the request issued a key, the account also carries `setup_key`
(`misty_setup_…`) and `setup_link` (`https://mistysys.com/setup#server=<MISTY_HOSTNAME>&key=<key>`);
otherwise both are absent. The key is stored only as a hash, so no later answer shows it again.
Create also answers `created` beside `account`. A list answers `{"accounts": [...]}`, never with
keys. Errors are `invalid_request` (400), `account_not_found` (404, also for an account whose
deletion has begun) and `account_pending_deletion` (409: create for an email whose account is
being deleted; it is free again once the purge finishes).

## Closing an account

`close` is how an account ends without its owner deleting it, for example when a Misty Cloud
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

The server sends no email about it: the billing service, or the operator, tells the person that
the account is read-only, how to export it (Export on the app's notice, or the Library for files)
and the deletion date. On the date, the account-deletion worker passes Spaces it owns that other people use pass to their
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
single use, valid for 7 days. The server never sends one: the operator API answers with the key
and its sign-in link, `https://mistysys.com/setup#server=<MISTY_HOSTNAME>&key=<key>`, and the
billing service emails it (Misty Cloud) or the operator passes it on (the console's **Sign-in
link**). The website's static page reads the fragment in the browser, which never sends it
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

The server sends no email, so there is no reset by email. A setup key is the reset: the redeem of
a Misty-password account also answers `password_reset_token`, which `PUT /v1/me/password
{reset_token, new_password, credential}` takes in place of the current password for 30 minutes
(`db.PasswordResetTTL`), once (stored by hash in `password_reset_tokens`, one per account). A
used, expired or other account's token answers 401 `password_reset_expired`. The change ends the
account's other sessions. The app's sign-in says, where "Forgot your password?" was, to ask the
person who runs the server for a sign-in link, and on Misty Cloud to get one at
`https://mistysys.com/sign-in` (billing's page, which looks the account up with
`GET /accounts?email=`, issues a key and emails the link). The old routes (`/auth/forgot`,
`/auth/reset*`) and email verification (`/auth/verify/start`, `/me/email/verify`) are gone; every
account counts as verified and `/me` answers `email_verified: true` for older apps.

### In the app

- The setup wizard's Misty Cloud screen (`src/features/auth/setup/CloudScreen.tsx`) takes a
  sign-in link, `https://mistysys.com/setup#server=<host>&key=<key>` (or an older server's own
  `https://<server>/setup#key=<key>`), or the server address and key typed apart.
  `misty://setup?server=<host>&key=<key>` from the website's setup page opens the wizard on that
  screen with both filled in (`src/app/routing/deepLinks.ts`, `src/features/auth/setupLinks.ts`).
  A link's server must be https and its key must have the setup-key shape, or the link is
  ignored; the key is held in memory only and never logged.
- Right after a redeem the wizard asks for a password (`ChoosePasswordScreen.tsx`). It is
  checked and derived on the device exactly as at registration (`accountSetFirstPassword` in
  `src/features/auth/store/accountPassword.ts`, `accountCredential.ts`): the server gets
  `PUT /me/password {current_password: "", new_password: <login credential>, credential: true}`,
  and the device keeps the email the keys come from, so the sync vault is created and opened like
  any other account's. A redeem whose response says `credential_account: false` marks the account
  as waiting for its password (`pendingPassword.ts`, device-local). While it waits, sync does not
  start (`BrowserSyncStartup`) and Settings › Sync offers **Choose password…** instead of the vault
  form; the wizard asks again each time the account is signed in on the device.
- For an account that has a password, the same screen asks for a new one ("Choose a new
  password") and sends the redeem's reset token with it (`passwordReset.ts`, memory only). Synced
  data encrypted with the old password stays locked; Settings › Sync resets it unless another
  computer still has it open. Without a token (the app restarted since), an account that turns
  out to hold a password already (the server refuses the empty current one) keeps it.

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
  wait on this device. The worker holds that collection's writes for ten minutes and clears the
  notice once a write goes through (`crates/browser-sync/src/worker/collections/exchange.rs`).
  `owner_storage_quota_exceeded` on uploads uses the same words.
- `account_suspended` from any request: a notice stays over the window
  (`AccountSuspendedNotice`) until dismissed or the account is signed in again, and sign-in shows
  the same words.
- `account_closing`, from `/me`'s `delete_at` or a refused change: a calm notice
  (`AccountClosingNotice`) says the account is read-only until the date, when it is deleted, and
  that subscribing again keeps it. Its **Export** button asks for the Misty password (sent as the
  derived credential, as at sign-in) or a fresh Google sign-in, calls `POST /me/export`, and saves
  `misty-account-<date>.json`: the account's data and a 15-minute link to each note, drawing and
  file (`src/features/auth/accountExport.ts`, `AccountExportDialog.tsx`). Device registration
  shows the same words (`src-tauri/src/infra/devices/http.rs`), and a refused sync write waits on
  the device (`crates/browser-sync`).
- `app_action_limit_reached:` in agent tool results: the conversation shows a plain line under
  the run's work (`src/features/agents/progress/usageLimits.ts`) when the step's error carries the
  code or the server's words; the agent runtime keeps the code in the error it reports
  (`visibleErrorMessage` in `server/apps/agent-runtime`).

## The operator console

`server/cmd/misty-console` (templ and htmx, loopback only; see the [server README](../../server/README.md#operator-console)).

- **Customers** lists accounts with status (owner, awaiting setup, suspended, closing), devices
  against their limit, and for the selected account its use this period against every limit,
  when a closing account is deleted, its devices and sessions. With `MISTY_OPERATOR_TOKEN` in the
  console's environment it also sets limits (blank for unlimited), suspends, closes (30 days),
  resumes and makes a **Sign-in link** (a new setup key, shown once with a Copy button, to
  onboard someone or reset their password), all through the operator API.
- **Backups** lists the database dumps in `server/.misty/backups` on that machine, and says it
  can't see copies kept elsewhere.
- **Logs** follows any service of the stack through docker compose on the console's machine. The
  server stack's console runs in a container without Docker, so there it says to use
  `docker compose logs` on the host.
- **Overview** is the status page: open alerts, health, traffic, database latency and recent
  operator actions.

## Code

| Where | What |
| --- | --- |
| `server/internal/platform/db/account_*.go` | Limits, suspension, closing, setup keys, period use, limit checks, the purge and the operator account queries |
| `server/internal/platform/db/space_purge.go` | The Space purge |
| `server/internal/platform/db/migrations/20271110000000_cloud_accounts.sql` | `account_controls`, `account_setup_keys`, `account_usage` |
| `server/internal/platform/db/migrations/20271112000000_account_closing_and_billing_periods.sql` | Closing columns, `period_anchor` and `misty_usage_period` |
| `server/internal/platform/db/migrations/20271112000500_account_closing_read_only.sql` | Closing no longer implies suspension |
| `server/internal/platform/httpapi/operator_*.go` | The operator API and its `limits` and `period_anchor` parsing |
| `server/internal/platform/httpapi/account_closing.go`, `account_purge.go` | Deletion start; Composio, R2 and Space purge steps |
| `server/internal/platform/httpapi/setup_keys.go`, `change_password.go`, `server/internal/platform/db/password_reset_tokens.go` | Key format, redemption and the password reset it allows |
| `server/internal/platform/httpapi/account_suspension.go` | The suspension and closing guard |
| `server/internal/platform/httpapi/account_read_only.go`, `server/internal/platform/db/account_read_only.go` | What a closing account may still do, and the write checks outside HTTP |
| `server/internal/platform/httpapi/usage_limits.go` | App action metering |
| `server/internal/platform/httpapi/registration.go` | Who may register |
| `server/internal/browsersync/storage_limit.go` | The storage limit on sync writes |
| `server/internal/console/customers*.go`, `operator_client.go`, `backups.go`, `logs.go` | Console pages |
