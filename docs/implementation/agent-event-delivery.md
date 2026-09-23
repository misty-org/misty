# Agent event delivery

Implemented September 19, 2026, across the Misty host and sibling misty-server checkout.

## Delivery path

Committed PostgreSQL changes → `pg_notify` → one `pq.Listener` per API process → authenticated `/misty/events` SSE → account-scoped client observers → durable snapshot reads.

The server migration `20270211000000_account_event_notifications.sql` emits small invalidations for agents, runs, invocations, queued device jobs, approvals, and interventions. Record bodies remain behind their existing authorized APIs. Each API instance receives notifications and distributes them only to subscribers for the affected user. App-runtime sessions cannot subscribe.

PostgreSQL notifications are ephemeral. Initial subscription, database listener reconnection, and subscriber-buffer overflow emit `reset`; clients reconcile from durable snapshots. SSE reconnection also produces a reset. Changes during a snapshot schedule a trailing refresh. This deliberately does not use the invalidation channel as a durable job queue. Job claims and leases remain authoritative in PostgreSQL; existing invocation output streams retain their own replay behavior.

The host shares a stream per account/deployment. Web Locks elect a leader across cooperating same-origin windows and BroadcastChannel distributes notifications. Closing the leader releases the lock for a waiting window. Platforms without those APIs share one stream per renderer. Session generations prevent delivery to a stale account session.

## Replaced requests

- Restored global agent tasks: recurring status fetches become event-driven reconciliation.
- Agent dashboard: five-second refresh becomes run/invocation invalidation.
- Approval and intervention activity: thirty-second refresh becomes invalidation.
- Agent rosters: update on agent invalidation.
- Desktop worker: recurring empty job claims become an initial drain, queued-job notifications, and another drain when an execution slot becomes available.

Observers coalesce event bursts and refresh on focus/online recovery. Device presence and execution lease heartbeats remain: they maintain eligibility and execution authority. Local native IPC timers are not HTTP traffic and remain. Other product polling is outside this change.

## Rate-limit recovery

All requests through the shared HTTP client respect a recorded 429 cooldown. `Retry-After` takes precedence over reconnect backoff. Cooldowns are shared through same-origin storage. The server marks route limits versus IP/origin abuse limits with `X-Misty-RateLimit-Scope`; an absent marker is treated conservatively as origin-wide. Suppressed requests return a local 429 without network activity. Mutations are not automatically queued for later replay. Expiry triggers observer reconciliation. SSE and worker error retries use backoff; completed-job delivery retries retain the exact result and respect `Retry-After`.

This reduces avoidable traffic and stops repeated network requests after a limit response. It cannot guarantee that a shared public IP never reaches a server limit: other clients, ongoing work, and first-time bursts still contribute.

## Rollout

1. Apply the server notification migration using the normal server deployment procedure.
2. Deploy the server with `/misty/events` and exposed rate-limit-scope header. Confirm the proxy permits streaming without buffering and supports a connection lasting ten minutes. The stream sends a comment every 25 seconds and reconnects after ten minutes to reauthenticate.
3. Deploy the matching host. The host has no status-polling compatibility fallback; an older server returning 404 will leave event-driven views without live invalidations until reconnection/focus refresh. Deploy the server first.
4. Smoke-test two windows: create an agent, finish a run, request/resolve approval, enqueue a device job, disconnect/reconnect, and close the stream-owning window. Confirm an idle account has no repeated status/claim requests and only the required liveness traffic.

No production migration or deployment was performed as part of this implementation.

## Verification and limits

- Selected client suites: 178 tests passed, including stream handoff between windows and worker behavior.
- TypeScript typecheck and targeted ESLint.
- Go HTTP abuse/rate-limit tests.
- PostgreSQL integration test under the Go race detector, using a disposable local database and two independent listeners: commit-only notification, rollback silence, account isolation, queued-job notification, suppression of lease-only updates, subscription reset, and bounded overflow reset.
- The database test uses a minimal isolated schema for the new trigger migration; it does not validate the complete historical migration chain, production proxy configuration, or end-to-end desktop behavior against a deployed server.
