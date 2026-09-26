# Billing service boundary

The private implementation is a standalone **Go/net/http** service in
`misty-org/misty-billing` with its own PostgreSQL database, migrations, credentials,
deployment and tests. No Hono or TypeScript payment runtime is deployed.

The public server owns the [provider-neutral adapter](billing-adapter.md),
authenticated account identity, raw usage measurements and durable completion
retries. It neither imports private source nor accesses the billing database.
Public customer actions and resource limits now use this adapter; legacy Stripe
handlers, workers and its Go SDK dependency have been removed.

The private service handles reservations, completion/refunds, customer actions,
allowance renewal, webhook reconciliation and checkout/closure recovery. Its
local database import has reconciled against preserved source records. It runs
locally with the writer disabled; the local public server uses adapter `none`.
Stripe test-mode checkout, portal, subscription reconciliation and closure
acceptance passed using temporary objects and an isolated database. No live-mode
payment-provider operations or production billing cutover were performed.

Hosted activation still requires full provider-boundary and commercial-parity
acceptance. Public publication also requires source/history sanitation across
all publishable references. See [the current status](migration/implementation-status.md).
