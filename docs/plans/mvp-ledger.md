# What's left for the Misty Cloud MVP

Status: active
Graduates to: docs/cloud/

Everything between what's on branch `open-source` (five commits, October 31, 2026) and a first
paying Cloud customer plus a working self-hosted server.

**MVP** means four things work end to end, on the real services:
- a person installs the app, browses, and connects to their own server;
- a person pays, gets a setup email (from misty-billing), connects to Misty Cloud, and runs
  agents on their own models;
- the operator runs the Cloud server and sees and manages customers;
- nothing loses data.

Each item says who it needs: **Build** (code work), **You** (an account, a decision or legal),
or **Check** (built but never run for real).

## P0: blocks any release

| # | Item | Needs | Where |
| --- | --- | --- | --- |
| 1 | **Nothing has run in the real app.** Run the wizard, the sign-ins, the agent runtime helper starting, a run claimed and finished, device embeddings, live transcription and the About row against the dev stack, then fix what breaks. | Check | `src/features/auth/setup/`, `src-tauri/src/infra/agent_runtime/`, `src/features/agents/runtimeDeliveries.ts` |
| 2 | **Done.** A release's Content Security Policy allows any `https:` and `wss:` origin, as development does, plus `ws://127.0.0.1:*` for the runtime's live relay; plain `http:` stays closed. `MISTY_RELEASE_API_URL`, `TAURI_CSP_CONNECT_SOURCES` and `TAURI_CSP_IMAGE_SOURCES` are gone: a release has no built-in server. Moving the sockets into Rust was not safer, since the renderer also fetches signed storage URLs on the chosen server's own hosts, and a renderer-driven socket bridge would reach any host the renderer named anyway. | Build | `cli/src/release/config.rs` |
| 3 | **The setup container has never met real Cloudflare.** Tunnel, DNS, R2 buckets with lock and lifecycle, the account tokens behind R2's S3 keys, and both Worker uploads were tested only against a fake. Run it once on a real account and fix the request shapes. Confirm the token permissions in `docs/cloudflare.md`. | You + Check | `server/deploy/setup/` |
| 4 | **Done, unchecked in the GUI.** After a redeem the wizard asks for a password, derived on the device as at registration and set with `PUT /me/password` and the redeem's `reset_token`; for an account that already has one, that is the password reset. Sync stays off until a first password is set, and an account that quits first is asked again at its next sign-in ([cloud/README.md](../cloud/README.md#in-the-app)). | Check | `src/features/auth/setup/ChoosePasswordScreen.tsx` |
| 5 | **Shipping the runtime in a release.** Needs a universal macOS Node for `MISTY_RELEASE_NODE` (made with `lipo` from Node's arm64 and x64 builds). Then build, sign and notarize once and check the packaged app starts its runtime: the `allow-jit` entitlement, the `agent-runtime` resource path and the `misty-node` sidecar. Windows needs its own Node `.exe`. | You + Check | `cli/src/release/runtime.rs` |
| 6 | **Stripe isn't connected.** Needs real products and price IDs (`STRIPE_PRICE_CLOUD_MONTHLY`, `STRIPE_PRICE_STORAGE_ADDON_MONTHLY`), a webhook endpoint, and misty-billing deployed beside the Cloud server with `MISTY_SERVER_URL`, `MISTY_OPERATOR_TOKEN` and `MISTY_BILLING_SECRET`. The website's checkout button is a placeholder: its backend must call billing's `POST /v1/checkout` and `/v1/portal`. | You + Build | misty-billing `cloud-accounts`, misty-website `cloud-docs` |
| 7 | **There's no Cloud server yet.** Needs the domain (`cloud.misty.example` is a placeholder in the app, the docs and the website), the machine it runs on, its four env files, and billing's setup email links pointing at it. | You | `src/lib/site.ts` (website), `OwnServerScreen.tsx` |
| 8 | **Google for the Cloud domain, and billing's email.** Set Google OAuth's redirect URI to `https://<domain>/v1/auth/google/callback`, and get the consent screen verified for production. The server sends no email; misty-billing's sender domain needs SPF and DKIM so its setup-key emails arrive. | You + Check | `google.env`, misty-billing |
| 9 | **Legal.** Server side done Oct 31: account deletion now purges everything Privacy §10 promises (owned Spaces with their R2 objects, sync vaults, memory, embeddings, agent chats, Composio connections, devices, sessions), checked by `account_purge_test.go`; face grouping is gone from the server. Terms and Privacy are drafts: get a lawyer's review and fill in `[YOUR LEGAL NAME]` and `[YOUR STATE]`. Review `NOTICE`, the AGPL section 7(b) attribution term. Send OpenAI's Sign in with ChatGPT interest form, since paid Cloud customers likely need it. | You | misty-website `src/pages/Legal/`, `NOTICE` |
| 10 | **Going public.** Rotate the Mailjet keys leaked in misty-website's history (commit 7ece399), then rewrite that history or publish a fresh copy. Decide misty's visibility and its old MIT history. The updater reads the public repo's releases. | You | `secrets-scan-report.md` in the notes folder |

## P1: needed for the MVP to be usable

| # | Item | Needs | Where |
| --- | --- | --- | --- |
| 11 | **The companion's spoken conversation** doesn't work on a server with no model keys. Its session loop runs on the device runtime ([agents/runtime.md](../agents/runtime.md)). | **Done (October 31).** Build | `agent_voice_conversation*.go` → runtime |
| 12 | **Done, unchecked in the GUI.** `misty://setup?server=<host>&key=<key>` opens the wizard on Misty Cloud with both fields filled in; an https server and a setup-key-shaped key are required. The wizard also reads the website's `https://mistysys.com/setup#server=…&key=…` links. | Check | `src/app/routing/deepLinks.ts`, `CloudScreen.tsx` |
| 13 | **Mostly done.** Device, storage (sync and uploads) and suspension codes show plainly with what to do next ([cloud/README.md](../cloud/README.md#what-the-app-shows)). Left: the server answers `device_limit_reached` as a bare 500 (`writeAgentError` doesn't map `db.ErrDeviceLimit`), and the agent runtime turns the search and app-action limit errors into "The tool could not complete this action." before the app sees them (`visibleErrorMessage`, `recoverableToolError` strips the code), so the chat line waits on those two server-side fixes. | Build | `server/internal/platform/httpapi/agent_errors.go`, `server/apps/agent-runtime/src/runtime-errors.ts` |
| 14 | **"Waiting for your computer."** Agents need the computer on. Email and Slack tasks and schedules wait until a desktop claims them. Show that state in the chat, and on the inbound task reply. | **Done (October 31).** Build | `runtimeDeliveries.ts`, inbound tasks |
| 15 | **Models on each new device.** Cloud customers set up models again on every computer, because settings never sync. Decide whether model choices (not keys, or keys end-to-end encrypted) may follow the account, which needs an exception to the rule in `AGENTS.md`. | You | `docs/byok.md` |
| 16 | **Summaries of older chat turns** aren't written on a server with no models. Older turns beyond the window are dropped. Write them on the device as a run ends, like titles. | **Done (October 31).** Build | `ai_conversation_compaction.go` |
| 17 | **A backup drill.** Restore a nightly backup on a fresh stack. Write down where the operator keeps the secrets volume and the backup key (`misty-setup backup-key`). | Check | `server/deploy/README.md` |
| 18 | **Done (server and billing, Oct 31).** `POST /operator/v1/accounts/{id}/close` makes the account read-only and runs the full purge on the date; the server sends no email, so billing sends the notice and warning; billing closes with 30 days when a subscription ends. **Read-only closing done (Oct 31):** a closed account is read-only, not suspended, for its 30 days. It signs in, reads and exports (the app's closing notice has an Export button); every change answers 403 `account_closing` with the deletion date; its agents and schedules stop; billing's emails say how to export. Suspension (14 days unpaid) still blocks sign-in and wins when both apply. | You | `docs/cloud/README.md` |
| 19 | **Done (Oct 31).** Every console page loaded against a throwaway stack. Fixed: the stack's Logs page looked for `compose.prod.yml`, closing accounts showed as plain suspended, and the API answered 500 for an email whose account is being deleted (now 409 `account_pending_deletion`). Customers can now close an account. | Done | `server/internal/console/` |
| 20 | **Done for the server (Oct 31).** The stack's `alerts` service records an open alert (`server_alerts`) when `/health` fails, 5xx reach 5%, disk runs low or a nightly backup is missed, and clears it when each clears; the console's Overview and the owner's app show them. No email. Not covered: R2 usage, and the whole host going away (needs an outside uptime check). | Build | `server/deploy/setup/watch.go` |
| 21 | **Merge with the eval campaign.** `eval-campaign` has commits that aren't on `main`, and its checkout has uncommitted DesktopLayout work. Merge `open-source` to `main` without breaking the campaign. | You | git |

## P2: after the MVP

| # | Item | Needs |
| --- | --- | --- |
| 22 | **Done (Oct 31).** The server has no model path: push mode, `MISTY_AGENT_RUNTIME_URL`, `internal/modelruntime`, `aimodels`, `byok`, the old Go agent loop and its providers, the server voice routes and tools, the server fallbacks for titles, summaries, day summaries, voice Notes, transcription and `browser.extract`, and the embedding worker are gone. Follow-up routing and page-state restore moved to device calls. The dev stack lost its runtime container and workflow Postgres, and the runtime lost its server-only routes and the Odysseys, free-model, voice and pointing evals ([agents/runtime.md](../agents/runtime.md#what-the-server-keeps)). | Build |
| 23 | **Done.** PostHog is gone from the app: `src/telemetry`, `src-tauri/src/telemetry.rs`, the Vite plugin, both packages and the two Privacy switches (their keys are pruned). The app no longer calls `PUT /me/telemetry` or sends `X-Misty-Analytics-Enabled`. | Build |
| 24 | **App-action pricing.** 1,000 Composio actions a month is a guess. Check Composio's cost for Cloud and set the plan. | You |
| 25 | **Unchecked provider details.** Ollama Cloud's `/v1` API path, OpenRouter's key check (`GET /api/v1/key`), and ChatGPT sign-in against the real preview. | Check |
| 26 | **Windows releases.** The Node sidecar for `aarch64-pc-windows-msvc` and x64, and the cross build with the runtime resource. | Build |
| 27 | **The worker test fixture** (`server/internal/platform/db/worker_fixture_test.go`) has drifted, so the tests it backs can't set up. | Build |
| 28 | **Misty Cloud price page copy and screenshots,** once the app is checked in the GUI. | You |

## Decisions (October 31, 2026)

- **Vault (#4):** the wizard asks for a password right after a setup key is redeemed. The
  password opens the vault the same way it does for every other account.
- **Model setup (#15):** stays per device. Model choices and keys don't sync.
- **Data after a subscription ends (#18):** the account is read-only and exportable for 30
  days, with a warning email, then everything is deleted.
- **Desktop analytics (#23):** PostHog is removed from the app.
- **Cloud host (#7):** `MISTY_HOSTNAME=api.mistysys.com`, so the API is at
  `https://api.mistysys.com/v1` and setup links go to `https://api.mistysys.com/setup#key=…`.
  Testing runs on the Mac behind the existing tunnel; a VPS is ready for later.
- **Eval campaign (#21, #22):** it's done. Remove the push path and merge everything to `main`
  so it starts clean.
- **Voice (#11):** the companion's spoken conversation moves to the device.
- **Stripe (#6):** test mode. You make the two prices and give their IDs and the webhook
  secret through the env files.
- **Accounts (#8):** Cloud reuses dev's Google OAuth client (adding the `api.mistysys.com`
  redirect) and Composio project. The server has no mail sender (below).
- **Servers serve API routes only.** The server's `GET /setup` page is removed. Setup emails
  link to the website's static `https://mistysys.com/setup#server=<host>&key=<key>`, which
  reads the fragment in the browser (it never reaches the website) and offers `misty://setup`
  plus the server and key to copy. This works for every server, self-hosted included.
- **The open server sends no email (October 31).** Mailjet and every server email are gone:
  email verification is dropped (every account counts as verified); a setup key's sign-in link
  replaces reset by email (the redeem's `password_reset_token` lets `PUT /me/password` set a new
  one, closing accounts included); a Space invitation answers with its `link`, which the app
  shows to copy; the `alerts` service records open alerts for the console and the owner's app.
  The operator API returns `setup_key` and `setup_link` instead of emailing, and
  `GET /accounts?email=` finds an account by exact email. Misty Cloud's emails (welcome, "email
  me a sign-in link" at `mistysys.com/sign-in`, closing notices) live in misty-billing.
  Self-hosting needs five env files, no mail provider ([cloud/](../cloud/README.md)).

## Decisions (November 1, 2026)

- **Web search moves to the device.** `web.search` runs in the desktop runtime on a search key
  the person keeps in Settings › Models, like a model key: Decodo (the default) or Serper
  ([byok.md](../byok.md#web-search)). Without a key it isn't offered. The server holds no search
  key, makes no search call and counts no searches: `search.env`, `MISTY_SEARCH_PROVIDER` and
  `MISTY_SEARCH_API_KEY` are gone, so self-hosting needs four env files. The `searches_per_month`
  limit and its usage are dropped (migration `20271114000000_no_web_search_limits.sql`); the
  operator API ignores the field, so misty-billing should stop sending it and its plans stop
  counting searches.

## Legal decisions (October 31, 2026)

- **Operator:** "Matthew Chen, an individual doing business as Misty", a sole proprietor for
  now. California law governs the Terms.
- **Server host named in Privacy §6:** OVHcloud.
- **Face grouping** (Library People) is removed for the MVP. The app has had no face grouping
  since Spaces were simplified (October 16): no UI, settings or client calls remain.
- **Cancelling** takes effect at the end of the paid month, with no partial refunds. EU
  customers keep the 14-day right to withdraw from a new subscription.
- **Failed payments:** suspend after 14 days of retries. Data is deleted 30 days after the
  subscription ends, with a warning email first.
- **Monthly app actions** reset on each customer's billing date, not the calendar month. (Web
  searches aren't counted since November 1: they run on each person's own key.)
- **Minimum age:** 13, or 16 in the EU and UK.
- **Tax:** Stripe Tax is on, and prices show "plus tax" where it applies.
- **The Misty name and logo:** a changed fork must rename, and may say it's based on Misty. The
  attribution term still applies.

- **One contact address,** `support@mistysys.com`, for help, privacy requests and takedowns.
  There is no `privacy@`.
- **A DMCA agent** gets registered for Misty Cloud, with `support@mistysys.com`.
- **Sign in with ChatGPT** is free and works on self-hosted servers and Misty Cloud alike,
  because the app calls OpenAI from the device and Misty hosts no model. It's never sold as
  part of Cloud, and OpenAI's interest form isn't used.
- **Legal review comes after launch.** The Draft notes come off once the details are filled
  in.

**Still yours:** the `support@` mailbox, the DMCA registration, and checking that
misty-billing's mail provider's and Composio's data processing terms apply. (Web search no
longer goes through Misty: each person's searches go from their device to their own Decodo or
Serper account.) Cloudflare, Stripe and Google include
theirs in their standard terms.
