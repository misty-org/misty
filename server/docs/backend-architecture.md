# Backend architecture

Misty is a browser workspace. The public Go server targets Accounts, current
Spaces features, account-wide Agents, and browser/device Sync. Authentication and
Space membership remain data boundaries. Agent access does not depend on the
retired downloadable-app permission system.

- Go owns account authentication, current product APIs, Agent orchestration, and sync.
- `apps/agent-runtime` runs durable multi-step Agent execution in TypeScript through
  its signed Go API boundary. Retired user routines are not Agent execution.
- `apps/journal-collab` and `apps/self-host-collab` provide Yjs collaboration;
  Go supplies membership checks and authorization tickets.
- The private `misty-org/misty-billing` service is Go with `net/http` and its own
  PostgreSQL database. No Hono or Node billing runtime is used.
- Public `internal/billingadapter` contains only admission and raw-usage protocol,
  HTTP authentication, and durable completion storage. Commercial rules belong
  exclusively in private billing.

Activepieces, retired app lifecycle/RPC, automation routines, and waitlist routes
are no longer mounted. Their historical database records are retained; deleting
routes does not authorize deleting customer data.

The running local API has no charging implementation and uses adapter `none`.
The separate private writer is disabled. Local migration and reconciliation have
passed. Hosted activation remains an explicit single-writer deployment operation,
separate from this local development delivery.

Sync transport and storage live in `internal/sync`. Account registration, profile
and session persistence and RLS scopes live in `internal/accounts`; PostgreSQL
wrappers preserve caller compatibility. Space membership/upload rules live in
`internal/spaces`, and Agent execution in `internal/agents`. Library attempt
metering lives in `internal/library` and sends raw measurements through the
neutral billing adapter.

Existing product HTTP/SQL adapters in `internal/platform` remain explicitly
identified compatibility code. They are not presented as generic infrastructure
or as a reason to rewrite working features. See the [directory map](../internal/README.md),
[billing-service.md](billing-service.md) and [billing-adapter.md](billing-adapter.md).
