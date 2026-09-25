# Optional billing adapter protocol

`internal/billingadapter` is the public, provider-neutral protocol implementation. It must not contain prices, trial rules, allowances, provider markups, Stripe code, or private database access.

## Configuration and deployment

Configuration has `Mode` (`none`, `null`, or `http`), `URL`, `Secret`, and an explicit hosted-deployment flag. Empty configuration is disabled for self-hosting. Hosted construction rejects a missing/disabled adapter. HTTP mode requires HTTPS and a secret of at least 32 bytes; an explicit development option allows loopback HTTP only. Redirects are rejected to prevent credential forwarding.

CLI integration file: `integrations/billing.env`. Environment keys: `MISTY_BILLING_ADAPTER`, `MISTY_BILLING_URL`, and `MISTY_BILLING_SECRET`. No private charging configuration belongs in this folder.

## Requests

POST to `<URL>/v1/<action>` with JSON:

```json
{"version":1,"account_id":"authenticated-account","operation":"agent.model","operation_id":"run-id","key":"stable-transition-id","usage":{"provider":"provider-id","model":"model-id","units":{"input_tokens":100,"output_tokens":1000},"estimated":true}}
```

Actions: `check`, `reserve`, `settle`, `settle_group`, `release_group`, `release`, `refund`, `summary`, `checkout`, `portal`, `close`, and `provision`. Settlement, release, and refund include `reservation_id`. Group completion includes a nonempty, unique `reservation_ids` list belonging to the same account and operation. Provider/model identity must match the reservation; mixed-model grouped
completion is rejected. Usage counts are nonnegative integers in their named native units, not prices. Identity comes from server authentication. Retries preserve the account, operation, and transition key.

Headers `X-Misty-Billing-Timestamp` (Unix seconds) and `X-Misty-Billing-Signature` bind the timestamp, HTTP method, escaped URL path and exact body with HMAC-SHA256. The signed bytes are timestamp, newline, method, newline, path, newline, then the body. The receiver rejects stale timestamps, verifies signatures in constant time, persists idempotency keys, and rejects key reuse with different payloads. A timestamp check alone does not prevent duplicate charging.

Successful JSON contains `allowed: true`; reserve also requires a nonempty opaque `reservation_id`. Optional `summary` is customer-visible data only. HTTP 402/403 is a denial; transport errors, redirects, malformed responses, missing reservation IDs, and other errors fail closed. Requests have a ten-second timeout.

## Durable completion

The SQL outbox records settlement/release/refund/customer closure before attempting delivery. Its key includes account identity. Conflicting payloads cannot overwrite an existing transition. Service failure retains the operation for retry; database failure is returned rather than losing usage. Concurrent delivery requires remote idempotency. Rollback refuses to drop a nonempty pending outbox.

Admission must guard every new provider operation, including worker execution. A request-level check alone does not bound a multi-step Agent. Completed work and cancellation must durably enqueue settlement/release even during billing outages; browsing and ordinary reads must remain available.

## Admission recovery

The service records an admission intent before contacting billing. A local receipt
must be saved before provider work starts. After an interrupted attempt expires,
a worker claims it as abandoned, repeats its original remote reservation key and
durably releases the resulting hold. A late receipt cannot revive abandoned work.
The disabled adapter skips both intent storage and network access.

## Customer actions

Checkout accepts optional `selection: {product, interval}` and trusted
`customer: {email, name}` supplied by the authenticated server. These are a
customer's requested offer and identity, not pricing instructions. The adapter
returns customer-visible URLs in `summary`. Reusing a transition key with changed
input is a conflict (409); invalid input is 400. A disabled adapter makes no
requests and customer payment actions return `billing_disabled`.

## Integration status

Public checkout, portal and usage handlers, model turns, voice, Library analysis,
transcription, semantic/visual queries and retrieval embeddings use the adapter. Account closure is durably
queued. Resource creation uses customer-visible adapter limits; self-hosting
without an adapter imposes no Misty plan requirement. Account reads, browsing,
recovery and cancellation remain available during billing outages.

Library creates an account-bound analyzer per request/job. Each physical model,
audit, fallback, transcription or embedding attempt gets its own reservation.
Completion uses the same persisted attempt key and actual provider/model identity.
Provider usage is reported without prices; missing usage is marked estimated.
Billing denial or an outbox-write failure prevents subsequent paid attempts.
Semantic search can still fall back to ordinary text search when AI is unavailable.

The local API is upgraded and runs with adapter `none`. The separate private Go
service has a reconciled local import and a disabled writer gate. Production
activation and packaging are outside this local delivery. See
[current extraction status](migration/implementation-status.md) for scope and
verification evidence.
