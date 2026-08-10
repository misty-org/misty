# Misty public beta operations

This runbook covers the desktop application, the Go API/PostgreSQL/R2 stack in
`../misty-server`, and the Journal collaboration Worker. Commands are examples;
production credentials belong in the deployment platform's secret store, never
in either repository.

## Environment topology

Development, staging, and production must each have distinct:

- PostgreSQL databases and application roles
- private R2 buckets and least-privilege API tokens
- Cloudflare Worker names, Durable Object namespaces, routes, and secrets
- OAuth applications and callback URLs
- Stripe modes, products, prices, endpoints, and webhook secrets
- telemetry projects, alert destinations, and release channels

Staging uses the same container, migrations, Worker bindings, TLS, and direct R2
transfer flow as production. It may use smaller quotas but must not use
in-memory storage or a local Library directory.

`misty-server/deploy/compose.staging.yml` provides the PostgreSQL/API topology
for a private staging host. Give it an immutable `MISTY_API_IMAGE` digest and a
server-side `.env.staging`; it runs the migration as a one-off gate before the
non-root, read-only API starts. Only the API loopback port is exposed, for the
host's TLS proxy or Cloudflare Tunnel. PostgreSQL remains on an internal Docker
network.

The manual `Build and deploy beta services` workflow builds the same API image
for either protected GitHub environment and deploys the Journal Worker name
configured in that environment. Worker secrets must be provisioned on each
target before first deploy. The workflow never copies staging secrets into
production or deploys the API image to an unspecified hosting vendor.

## Release gate

1. Require both repositories' CI checks on the release commit.
2. Build from a clean annotated version tag.
3. Record the API image digest, Worker version ID, database migration version,
   desktop checksums, SBOMs, and third-party notices in the release.
4. Exercise login, one note edit, one drawing edit, one direct R2 upload and
   download, billing test mode, and each enabled OAuth provider in staging.
5. Obtain approval for the migration and customer-visible release notes.

## Database migration

1. Verify the new API is backward-compatible with the currently deployed
   schema and the migration is forward-compatible with the old API.
2. Take and identify a PostgreSQL backup/PITR restore point.
3. Run the pinned Goose migration tool as a one-off deployment job using a
   migration role, not from every API replica.
4. Confirm the latest `goose_db_version`, then deploy the new API image.
5. Watch database errors, connection saturation, API 5xx responses, and
   collaboration control backlog for at least 15 minutes.

Production migrations are forward-fix by default. A down migration is used only
when it is explicitly data-safe and has been rehearsed against a restored
staging copy. Otherwise, roll the API forward with a corrective migration.

## API deployment and rollback

The production `misty-server/Dockerfile` is the sole API build definition. Run
it read-only where practical, as its built-in UID 10001, with port 8080 and the
secret/environment contract in `misty-server/.env.example`.

Deployment:

1. Build once and scan the image; promote the same digest to staging and
   production.
2. Run the controlled migration job.
3. Start a canary and require `/health` to return success.
4. Shift traffic gradually while monitoring latency, 5xx, database and R2
   health, and background job backlogs.

Rollback:

1. Stop traffic promotion and restore the previous image digest.
2. Do not reverse a schema change unless its down migration was rehearsed.
3. Confirm `/health`, authentication, Journal tickets, and direct R2 transfer.
4. Preserve logs and open an incident record for any user-visible failure.

## Journal Worker deployment and rollback

Before deployment, verify that the Worker's public hostname exactly equals the
API's `PARTYKIT_HOST` and that issuer/audience values match.

1. Run Worker typecheck, tests, production audit, and Wrangler dry-run build.
2. Deploy to staging and record the returned Cloudflare version ID.
3. Test note and drawing cold load, reconnect, viewer denial, ACL revocation,
   persistence, and purge.
4. Deploy the same source to production and record its version ID.
5. If errors increase, immediately route the previous Cloudflare version.
   Snapshot manifests retain the prior complete generation, so a partial write
   is not promoted.

## Journal signing-secret rotation

`JOURNAL_COLLAB_ROOM_SALT` is a stable room-identity key. Do not rotate it:
changing it would derive different Durable Object names and strand existing
documents. It is separate from the independently rotatable signing secrets.

Rotate ticket and control secrets without dropping live rooms:

1. In the Worker, set `JOURNAL_COLLAB_TICKET_PUBLIC_KEY_PREVIOUS` and
   `JOURNAL_COLLAB_CONTROL_SECRET_PREVIOUS` to the currently active values.
2. Set the Worker's active ticket public key and control secret to the new
   values. At this point it accepts both generations.
3. Deploy the API with the matching new ticket private key and control secret.
4. Wait longer than the 60-second ticket lifetime, confirm fresh connections
   and control commands, then remove both Worker `_PREVIOUS` secrets.

Rotate the projection secret in the opposite direction:

1. Deploy the API with the old value in
   `JOURNAL_COLLAB_PROJECTION_SECRET_PREVIOUS`.
2. Change the Worker's active projection secret to the new value.
3. Wait through the longest projection retry window, verify callbacks, then
   remove the API's `_PREVIOUS` value.

Never log secret values. If any stage fails, restore only the prior active
value while dual-read remains enabled and verify note/drawing control delivery
before continuing.

## Durable Object recovery

Each room stores a manifest committed after generation-specific Yjs chunks. The
reader verifies length and SHA-256, then falls back to the retained previous
generation or legacy snapshot.

1. Prevent new connections to the affected room and preserve Worker logs.
2. Inspect only manifest/chunk metadata; never log room IDs, user IDs, or
   document content.
3. If the current generation is corrupt, deploy the known-good Worker reader;
   it automatically loads the previous verified generation.
4. Open the document in staging-equivalent tooling, save once, and verify the
   new current manifest checksum before restoring access.
5. Use the authenticated `purge` control only for an approved deletion; it is
   not a recovery mechanism.

Cloudflare account-level Durable Object recovery/PITR capabilities and support
contacts must be confirmed by the owner before public beta.

## R2 retention and recovery

- `library/` and `avatars/` are permanent prefixes. Never attach an age-based
  bucket lifecycle deletion rule to them.
- Incomplete upload reservations expire through the API cleanup worker.
- Unreferenced Journal assets wait 24 hours, then reference-aware garbage
  collection deletes an R2 object only after the last deduplicated reference.
- Enable bucket deletion protection/versioning where available and document
  its actual retention window in the deployment record.
- A missing permanent object is treated as corruption. Stop destructive
  reconciliation, preserve the database row, restore the object by exact key,
  size, and SHA-256, then retry.

R2 credentials are write/delete capable and must be independently rotatable.
The desktop never receives them; it receives short-lived, exact-key presigned
requests only.

## PostgreSQL restore

1. Declare an incident and stop all API/background-writer traffic.
2. Create a new isolated database from the selected PITR timestamp; never
   restore over the only production copy.
3. Run integrity checks, confirm the latest migration version, and compare
   account-deletion tombstones plus R2 reconciliation counts.
4. Point a staging API/Worker pair at the restored database and exercise login,
   Journal ACL changes, direct upload/download, billing entitlements, and
   provider metadata without calling live provider mutations.
5. Promote the restored database by connection-string change, keep the prior
   database read-only, and monitor error/queue metrics.
6. Reapply every completed account deletion between the restore point and
   incident cutoff before allowing user traffic.

## Provider outage

1. Disable new connect/refresh/sync actions for only the affected provider at
   the API deployment configuration or provider gateway.
2. Keep existing local files and cached metadata readable; do not erase a
   credential merely because the provider is unavailable.
3. Bound retries with backoff and watch provider job/event backlogs.
4. Post a scoped status update without naming accounts or resources.
5. Resume a canary connection, refresh, read, write, revoke, and disconnect
   flow before draining the backlog.

## Billing incident

1. Stop new checkout/portal creation while keeping signed webhooks available.
2. Preserve raw Stripe event identifiers and API audit logs; never log card or
   customer secret data.
3. Replay only signature-verified events through the idempotent webhook path.
4. Reconcile Stripe subscription state, local entitlements, credits, and
   storage/AI quotas before re-enabling checkout.
5. Do not delete user data or revoke existing access solely because Stripe is
   temporarily unavailable.

## Account-deletion incident

1. A failed provider or storage cleanup leaves the deletion request retryable
   and preserves encrypted credentials until revocation can be retried.
2. Inspect only the request id, status, timestamps, and redacted error code.
3. Fix the dependency, rerun the background processor, and verify provider
   status plus session revocation.
4. At the due date, anonymize the account only after cleanup is scheduled.
5. Verify shared Space content remains governed by its normal owner/resource
   lifecycle and completed deletion tombstones survive database restores.

## Alerts and response expectations

Import `misty-server/deploy/observability/grafana-dashboard.json` and load
`misty-server/deploy/observability/prometheus-rules.yml` into the selected
Prometheus-compatible monitor. Scrape the API's token-protected `/metrics`
endpoint over the private deployment network. Never place the metrics bearer
token in a dashboard.

Cloudflare Worker and R2 telemetry remains at the edge rather than being
proxied through the API. Connect Cloudflare Logpush/Workers Analytics Engine to
the same alert destination and create count alerts for the structured Worker
events `document_persistence_failed`, `document_limit_exceeded`,
`document_snapshot_recovered`, `connection_refused`, and
`connection_revoked`. Alert on R2 5xx responses, failed operations, unusual
delete volume, and storage/budget thresholds. Join API and Worker investigations
with `request_id`/`correlation_id`; do not copy signed URLs into the dashboard.

Page the beta on-call contact for:

- acknowledged collaboration saves failing or document-limit blocks spiking
- API 5xx or p95 latency above the agreed service objective
- database connection exhaustion, failed backups, or replication/PITR lag
- R2 health failures, checksum mismatches, or unusual delete volume
- Worker exceptions, WebSocket refusal spikes, or control-command backlog
- authentication abuse blocks, Stripe webhook failures, and AI budget refusal

The owner records primary and backup recipients, quiet hours, and beta response
expectations in the private operations system.

## Incident response

1. Declare severity and an incident lead; preserve timestamps and evidence.
2. Contain the failure without destroying evidence. Disable a feature at its
   API boundary or roll back the affected immutable version.
3. Rotate exposed credentials and revoke sessions when compromise is possible.
4. Determine affected users/data and maintain a decision log.
5. Use the approved support/status channels for updates.
6. Follow counsel-reviewed breach-notification deadlines and jurisdictional
   requirements.
7. Restore service, validate data integrity, monitor, and publish a blameless
   corrective-action review.

Do not put document content, access tokens, presigned URLs, passwords, or full
user identifiers into tickets, logs, telemetry, or incident chat.
