# Browser server extraction status — 2026-09-25

## Local deployment boundary

The public server lives in `misty/server`. Private `misty-org/misty-billing` uses
Go/net/http and a separate database; it preserves the original server ancestry.
Only local/development databases and services have been changed. The public API
runs schema **20270224000000**, with adapter `none`, no payment-provider credentials,
and healthy status. The private API runs migration **016**, with its writer
**disabled**. No hosted charging authority has been enabled.

## Closed implementation and migration gates

- Removed Activepieces, user routines, waitlist, catalog/onboarding selection,
  downloadable-app installation/session/RPC endpoints, installation persistence,
  manifest verification and obsolete control handlers. Historical records and
  original source are preserved privately. Current connected-provider execution,
  account Agent approvals, GitHub integrations, first-party tools and native
  workers remain. An old app principal cannot become an account credential.
- Current device file APIs and connected Agent tools no longer require an app
  installation. Account identity, device trust, target revisions and Space
  membership remain enforced. Connected backend tests cover reads, approved
  writes, duplicate execution and an uncertain provider response.
- Fresh public installations use **one clean baseline migration**, without
  commercial schema or retired installation tables. Existing databases at or
  above 20270215120000 receive the neutral incremental upgrades inline. Older
  databases require the private archived upgrade chain first. Nine retired app
  tables move intact to operator-only `misty_archive`; runtime access is revoked.
- Actual Goose fresh-install and restored-database upgrade rehearsals passed,
  followed by the backed-up local upgrade. Code removal did not erase user data.
- The private import preserves **29 accounts, 14 wallets, 9 subscriptions,
  9 checkout records and 136 webhook markers**, with no outstanding legacy holds.
  Version 2 also preserves purchase-reversal records. Both a fresh V2 import and
  the existing immutable V1 local import passed row-by-row reconciliation.
- The neutral adapter covers admission, durable completion/release/refund,
  interruption recovery, account closure and customer actions. Self-hosting with
  `none` makes no billing calls. Model reservations pin provider/model identity;
  mismatched completion is rejected. Voice transcription separately admits and
  settles its selected model and fallback; denial cannot trigger fallback work.
- Sync HTTP/WebSocket handling and SQL now live in `internal/sync`. Account
  session/profile rules and Space permission/upload rules have real domain
  implementations. Shared transport owns JSON output and account events.

## Acceptance evidence

- Public Go vet, internal/unit tests and the full PostgreSQL/HTTP API/HTTP app
  contract suites passed against disposable PostgreSQL. The suite now exercises
  account tools without the retired installation fixtures. Account integration
  verifies that a legacy Space parameter cannot expose another account's journal.
  The architecture checks enforce production import boundaries and the 500-line
  file limit while allowing colocated unit tests.
- All 60 CLI tests and 86 Agent-runtime tests passed; runtime typechecking passed.
- Rust browser-sync tests and the native Rust worker against the Go WebSocket
  server passed, including the authenticated reconnect path.
- Private Go race tests passed with all three database suites explicitly enabled:
  ledger/reservation concurrency, refunds, model identity, customer lifecycle,
  interrupted checkout recovery, grants, import and reconciliation. No database
  suite was counted as passing merely because its environment variable was absent.
- A real Stripe **test-mode** run passed checkout creation/replay, portal creation,
  trial subscription reconciliation, cancellation and account closure cleanup.
  It used a disposable database and temporary test objects, which were cleaned
  up. No checkout was paid and no live-mode provider operation was performed.
- History tooling prepares a separate candidate covering all publishable branches
  and tags, preserves contributor identities/dates, audits reachable historical
  blobs, and runs secret scanning. The original dirty working tree and refs are
  untouched. Passing the candidate audit is not publication of rewritten history.

## Current completion scope

The user narrowed this work to **working Go billing and an organized, lean
browser server**. Packaging and packaged desktop acceptance belong to the user.
Public-history publication, credential rotation and production billing activation
are separate release operations, not completion gates for this development pass.
Keep the existing local/development-only deployment boundary.

The scoped implementation is complete:

- Library analysis, audits, fallbacks, transcription, visual/semantic queries and
  retrieval embeddings reserve and complete each actual provider attempt using
  its actual model. Raw usage stays separate across models; unavailable usage is
  explicitly estimated. Billing denial or failed durable recording stops further
  paid calls. Cancellation does not discard completed usage, and adapter outages
  leave durable completion work for retry.
- Accounts owns registration, profiles, settings, avatar references, session SQL
  and account RLS scopes. Existing PostgreSQL entry points are compatibility
  delegates. Sync owns its transport and persistence; Spaces owns membership and
  upload policy; Agents retains its execution machinery. The current directory
  map is in [internal/README.md](../../internal/README.md).
- Retired product routes, workers and installations remain removed. Current
  first-party APIs retain their HTTP/SQL adapters rather than undergoing another
  wholesale rewrite. No production activation or packaging is included.

Machine-readable evidence: [dependency inventory](dependency-inventory.json).
The inventory is a review aid, not permission to delete an unmatched feature.
