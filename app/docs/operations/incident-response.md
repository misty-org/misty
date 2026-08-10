# Misty incident-response procedure

## Scope and severity

- **SEV-1:** confirmed credential compromise, unauthorized private-data access,
  unrecoverable data loss, or widespread inability to save.
- **SEV-2:** material degradation, contained authorization issue, delayed
  processing, or partial provider outage with a workaround.
- **SEV-3:** limited defect without confidentiality or durable-data impact.

The incident lead records start time, detection source, affected release and
environment, decision log, owners, user impact, and next update time. Use an
internal incident identifier in logs and communications; never paste user
content or credentials.

## First 30 minutes

1. Confirm the signal using privacy-safe metrics and immutable deployment IDs.
2. Assign incident lead, operations owner, communications owner, and scribe.
3. Preserve relevant logs, Cloudflare version IDs, API image digest, database
   migration version, and alert evidence.
4. Contain with the narrowest control: disable the affected API capability,
   revoke a provider route, stop promotion, or roll back an immutable version.
5. For suspected credential exposure, revoke sessions and rotate the affected
   credential using the dual-read rotation procedure where available.
6. Establish impact bounds: environments, time window, users, Spaces, object
   keys/counts, and data categories. Do not export content to the incident room.

## Data integrity

- Collaboration save incident: block new writes if acknowledgements are not
  durable, preserve current/previous manifests, and exercise verified fallback.
- R2 incident: stop destructive reconciliation, compare PostgreSQL expectations
  to HEAD metadata, restore exact key/size/SHA-256, then resume.
- Database incident: freeze migrations, identify the last healthy PITR point,
  restore to isolated staging, verify authorization and counts, then promote.
- Deletion incident: pause the cleanup worker without reverting already
  completed provider revocations; reconcile each request by request ID.

## Communications and notification

The owner must define private on-call, support, status, privacy, security, and
legal contacts before beta. User updates state what happened, observed impact,
current mitigation, user action if any, and next update time. Do not speculate.

Counsel/privacy ownership determines whether an event is a reportable breach,
affected jurisdictions, regulator/individual deadlines, and message content.
The technical team supplies a timestamped facts package and preserves evidence.

## Recovery and closure

1. Validate health, authorization, data integrity, background queues, and
   direct transfer in staging or an isolated restored environment.
2. Restore production gradually and watch error/latency/save/checksum signals.
3. Confirm provider, billing, and deletion workflows independently.
4. Close only after user impact ends, evidence is retained, and follow-up work
   has owners and deadlines.
5. Publish a blameless review covering trigger, detection gap, contributing
   conditions, impact, response timeline, corrective actions, and verification.

## Exercise cadence

Before public beta, rehearse an API rollback, Worker rollback, PostgreSQL
restore, corrupt-current Durable Object fallback, missing R2 object recovery,
signing-secret rotation, provider outage, and account-deletion retry. Repeat the
highest-risk scenarios quarterly and after material architecture changes.

