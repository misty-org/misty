# Misty Public Beta Readiness

This document is the release checklist and definition of done for Misty's public
beta. It covers the desktop application in this repository and the API,
database, R2, and Journal collaboration Worker in `../misty-server`.

## Status convention

- `[ ]` Not complete
- `[x]` Implemented and verified
- **Owner: Codex** means the work can be completed in the repositories.
- **Owner: Matt** means an external account action, credential, legal approval,
  or physical-device action is required.
- An item is only checked after its relevant automated or manual verification
  has passed.

## Release gate

Public beta is ready only when:

- [x] All required frontend, Rust, Go/database, and Worker CI checks pass.
  **Owner: Codex**
- [x] No known path can acknowledge user edits that will not be persisted.
  **Owner: Codex**
- [ ] Signed macOS artifacts and the Windows installer install and update
  successfully.
  **Owner: Codex + Matt**
- [ ] Production API, PostgreSQL, R2, and Journal Worker have health monitoring,
  alerts, backups, and rehearsed recovery procedures. **Owner: Codex + Matt**
- [ ] Account deletion, data export, privacy disclosures, terms, support, and
  incident-response processes are available. **Owner: Codex + Matt**
- [ ] The packaged Mac and Windows applications pass the two-user acceptance
  matrix at the end of this document. **Owner: Codex + Matt**

## 1. Establish a green release baseline

- [x] Preserve and test the stable Excalidraw presence/reconnect fix.
  **Owner: Codex**
- [ ] Commit/review the accumulated beta changes. **Owner: Matt**
- [x] Keep `.env.desktop` local and untracked so its configuration cannot be
  committed. **Owner: Codex**
- [x] Fix the environment/profile isolation Rust test. **Owner: Codex**
- [x] Fix the local move undo/redo Rust test. **Owner: Codex**
- [x] Fix the local rename undo/redo Rust test. **Owner: Codex**
- [x] Make formatting checks pass. **Owner: Codex**
- [x] Resolve or deliberately re-baseline readability and file-size checks.
  **Owner: Codex**
- [x] Replace raw interactive elements identified by the shared-UI check.
  **Owner: Codex**
- [x] Keep the desktop production build passing and establish bundle-size
  reporting. **Owner: Codex**

## 2. Continuous integration and release automation

- [x] Add frontend CI for install, typecheck, tests, quality gates, production
  build, and dependency audit. **Owner: Codex**
- [x] Add native CI for Rust formatting, linting, tests, and Tauri builds.
  **Owner: Codex**
- [x] Add backend CI with a disposable PostgreSQL service and migrations.
  **Owner: Codex**
- [x] Add Journal Worker CI for typecheck, tests, production dependency audit,
  and deployment validation.
  **Owner: Codex**
- [x] Pin Node, Go, Rust, Wrangler, PostgreSQL/pgvector, and the migration
  toolchain in CI. **Owner: Codex**
- [x] Add release artifact checksums, dependency/license inventory, and SBOM
  generation. **Owner: Codex**
- [ ] Protect the release path so deployment cannot bypass required checks.
  **Owner: Matt**

## 3. Journal collaboration durability and authorization

- [x] Prevent notes and drawings from accepting edits that would exceed the
  persisted document ceiling. **Owner: Codex**
- [x] Warn users before the document ceiling is reached and provide a clear
  recovery action. **Owner: Codex**
- [x] Make persistence failures visible to connected clients and monitoring.
  **Owner: Codex**
- [x] Make chunked snapshots resilient to interruption and partial writes.
  **Owner: Codex**
- [x] Test NoteRoom and DrawingRoom cold load, save, restart, reconnect, purge,
  and recovery. **Owner: Codex**
- [x] Test viewer write denial, ticket replay, expired tickets, ACL version
  changes, and permission revocation on an open socket. **Owner: Codex**
- [x] Test the room connection limit and oversized WebSocket messages.
  **Owner: Codex**
- [ ] Verify stable names, cursors, and follow mode across disconnect/reconnect
  on two real clients. **Owner: Codex + Matt**
- [x] Add a documented Durable Object recovery procedure. **Owner: Codex**
- [ ] Confirm Cloudflare account recovery capabilities and rehearse the
  procedure against staging. **Owner: Matt**
- [x] Add a no-downtime rotation procedure for ticket, control, and projection
  signing secrets. **Owner: Codex**

## 4. R2 direct binary asset pipeline

- [x] Keep Journal image bodies out of the API and Durable Object processes.
  **Owner: Codex**
- [x] Verify presigned PUT signatures bind key, size, MIME type, and checksum.
  **Owner: Codex**
- [x] Verify finalization rejects missing objects and size/checksum mismatches.
  **Owner: Codex**
- [x] Add validated automation for an exact-origin, exact-method R2 CORS policy.
  **Owner: Codex**
- [ ] Apply and verify the CORS policy on staging and production buckets.
  **Owner: Matt**
- [ ] Use separate least-privilege R2 credentials and buckets for development,
  staging, and production. **Owner: Matt**
- [x] Add application-managed lifecycle cleanup for abandoned uploads and
  temporary objects without expiring permanent Library or Journal prefixes.
  **Owner: Codex**
- [ ] Confirm the production bucket has no blanket expiration rule covering
  `library/` or `avatars/`. **Owner: Matt**
- [x] Add database-to-R2 reconciliation for missing and orphaned objects,
  expired reservations, and interrupted finalization. **Owner: Codex**
- [x] Connect asynchronous scanning/quarantine where promised, or accurately
  mark direct objects as unscanned and enforce the safe-format policy.
  **Owner: Codex**
- [x] Test duplicate uploads, deduplication repair, deletion, expired signed
  URLs, checksum failure, offline retry, and concurrent finalization.
  **Owner: Codex**
- [ ] Test direct upload and download from packaged Mac and Windows applications.
  **Owner: Codex + Matt**

## 5. Application and API security

- [x] Triage production dependency advisories and remediate all reachable high
  severity findings. **Owner: Codex**
- [x] Document any accepted transitive advisory with code-path evidence and an
  upgrade plan. **Owner: Codex**
- [x] Restrict the production Tauri CSP to explicitly trusted API, WebSocket, telemetry,
  asset, and OAuth hosts. **Owner: Codex**
- [x] Replace broad `$HOME/**` asset and opener access with the smallest
  functional scopes. **Owner: Codex**
- [x] Review clipboard, window, filesystem, opener, and custom protocol
  capabilities per webview. **Owner: Codex**
- [x] Add current-source secret scanning and verify release bundles, structured
  logs, telemetry, and crash reports exclude secret-bearing fields.
  **Owner: Codex**
- [ ] Rotate credentials found in historical server commits and decide whether
  to rewrite shared Git history. **Owner: Matt**
- [x] Validate trusted proxy configuration and prevent forwarded-IP spoofing.
  **Owner: Codex**
- [x] Verify rate limits for authentication, collaboration tickets, upload
  initiation, billing, and expensive AI routes. **Owner: Codex**
- [x] Add authorization tests for guessed identifiers, cross-Space access,
  former members, and revoked sessions. **Owner: Codex**

## 6. Production deployment and environment management

- [x] Add a production backend container/build definition with a non-root
  runtime, health check, pinned dependencies, and graceful shutdown.
  **Owner: Codex**
- [x] Add staging API/PostgreSQL topology and environment-isolated Worker
  deployment automation. **Owner: Codex**
- [ ] Provision and validate the staging resources. **Owner: Matt**
- [ ] Maintain separate databases, R2 buckets, Worker namespaces, OAuth apps,
  Stripe modes, and secrets per environment. **Owner: Matt**
- [x] Create an authoritative environment schema and production startup
  validation. **Owner: Codex**
- [x] Expand `.env.example` without adding secret values. **Owner: Codex**
- [x] Run migrations as a controlled deployment job with backup, compatibility,
  and forward-fix procedures. **Owner: Codex**
- [x] Document API and Worker rollback. **Owner: Codex**
- [ ] Rehearse API and Worker rollback against staging. **Owner: Codex + Matt**
- [ ] Verify the deployed Journal Worker hostname matches the API's
  `PARTYKIT_HOST`. **Owner: Codex + Matt**
- [ ] Configure stable production custom domains and TLS. **Owner: Matt**

## 7. Desktop signing, packaging, and updates

- [x] Add the Tauri updater runtime, HTTPS-only release configuration,
  signed-artifact build job, and draft update feed generation. **Owner: Codex**
- [ ] Run the release job with the production signing key and HTTPS feed, then
  install its signed update artifacts. **Owner: Codex + Matt**
- [ ] Back up the updater private key outside the repositories. **Owner: Matt**
- [ ] Build, Developer ID sign, notarize, and staple the macOS artifacts.
  **Owner: Codex + Matt**
- [ ] Authenticode sign the Windows executable and NSIS/MSI installers.
  **Owner: Codex + Matt**
  Deferred for the early beta; label Windows downloads as unsigned until this
  is complete.
- [ ] Verify macOS Gatekeeper and Windows SmartScreen behavior on clean
  machines. **Owner: Matt**
- [ ] Test fresh install, upgrade, failed update, rollback/reinstall, and
  uninstall without unintended user-data loss. **Owner: Codex + Matt**
- [x] Define versioning, release notes, beta channel, and release promotion.
  **Owner: Codex**

## 8. Observability, backup, and incident operations

- [x] Emit privacy-safe structured logs with request/correlation identifiers
  across the desktop, API, and Worker. **Owner: Codex**
- [x] Add importable dashboards and alert rules for API errors/latency,
  database health, WebSockets, quotas, and job backlogs. **Owner: Codex**
- [ ] Connect the dashboard to production metrics plus Cloudflare Worker/R2
  analytics. **Owner: Matt**
- [x] Add repository alert rules and privacy-safe Worker event definitions for
  failed saves, elevated 5xx responses, database exhaustion, Worker/R2
  failures, and budget thresholds. **Owner: Codex**
- [ ] Configure the production alert destination and threshold overrides.
  **Owner: Matt**
- [ ] Configure PostgreSQL backups/PITR and perform a restore drill.
  **Owner: Codex + Matt**
- [x] Document R2 deletion protection, retention, and recovery expectations.
  **Owner: Codex**
- [x] Add privacy-safe crash reporting and an opt-in support bundle.
  **Owner: Codex**
- [x] Write deploy, rollback, database restore, Durable Object recovery, secret
  rotation, provider outage, billing incident, and data-deletion runbooks.
  **Owner: Codex**
- [ ] Define alert recipients and beta response expectations. **Owner: Matt**

## 9. Account lifecycle, privacy, legal, and support

- [x] Implement authenticated account deletion with reauthentication,
  background cleanup, provider revocation, and auditable status.
  **Owner: Codex**
- [x] Implement a user-requested portable data export. **Owner: Codex**
- [x] Define and enforce application retention for deleted accounts, files,
  Journal Durable Objects, and abandoned uploads. **Owner: Codex**
- [ ] Configure and verify production log, telemetry, R2 version, and database
  backup retention. **Owner: Matt**
- [x] Draft the Privacy Policy. **Owner: Codex**
- [ ] Legally review and publish the Privacy Policy. **Owner: Matt/legal review**
- [x] Draft the Terms of Service and desktop license agreement. **Owner: Codex**
- [ ] Legally review and publish the Terms of Service and desktop license
  agreement. **Owner: Matt/legal review**
- [x] Generate third-party notices and verify attribution/license obligations.
  **Owner: Codex**
- [x] Document subprocessors, telemetry, crash collection, and OAuth data use.
  **Owner: Codex**
- [x] Reconcile actual telemetry behavior with desktop/mobile privacy
  disclosures and consent. **Owner: Codex**
- [ ] Add support, privacy, security, and abuse contact paths. **Owner: Matt**
- [x] Write an incident-response and breach-notification procedure.
  **Owner: Codex**
- [ ] Legally review the breach-notification procedure and supply regulator and
  insurer contacts. **Owner: Matt/legal review**

## 10. Provider, billing, and product acceptance

- [x] Cover provider catalog, authorization, disconnect/revocation, duplicate
  connection, refresh, and transfer recovery behavior in automated tests.
  **Owner: Codex**
- [ ] Exercise Google Drive, Dropbox, and OneDrive user-controlled OAuth against
  the staging provider applications. **Owner: Matt**
- [x] Cover Stripe signatures, idempotency, cancellation, entitlements, and
  quota behavior in automated tests. **Owner: Codex**
- [ ] Exercise checkout, portal, cancellation, and refunds with staging Stripe,
  then verify test/live isolation before promotion. **Owner: Matt**
- [x] Disable unfinished functionality at the API boundary, not only in the UI.
  **Owner: Codex**
- [x] Add actionable empty, loading, failure, retry, and offline states for the
  critical public-beta paths. **Owner: Codex**
- [x] Add configurable in-product feedback/support and security paths.
  **Owner: Codex**
- [ ] Publish and configure the feedback/support destinations. **Owner: Matt**
- [ ] Recruit an initial public-beta cohort and define the feedback cadence.
  **Owner: Matt**

## 11. Packaged two-user acceptance matrix

- [ ] Apple Silicon macOS fresh install and upgrade. **Owner: Matt**
- [ ] Intel macOS fresh install and upgrade, if supported. **Owner: Matt**
- [ ] Windows 10 fresh install and upgrade, if supported. **Owner: Matt**
- [ ] Windows 11 fresh install and upgrade. **Owner: Matt**
- [ ] Invite, join, leave, remove, and rejoin a Space. **Owner: Codex + Matt**
- [ ] Simultaneously edit notes and drawings across Mac and Windows.
  **Owner: Codex + Matt**
- [ ] Verify names, cursors, presence, and follow mode after reconnect.
  **Owner: Codex + Matt**
- [ ] Revoke permissions while sockets and asset URLs are active.
  **Owner: Codex + Matt**
- [ ] Exercise sleep/wake, offline, slow, flaky, proxied, IPv6, and network
  switching behavior. **Owner: Codex + Matt**
- [ ] Exercise large drawings, large folders, storage quotas, and room
  connection limits. **Owner: Codex + Matt**
- [ ] Exercise local copy, move, rename, delete, conflict, undo, and redo.
  **Owner: Codex + Matt**
- [ ] Verify keyboard navigation, zoom, contrast, and screen-reader-critical
  workflows. **Owner: Codex + Matt**

## Credential and external-action handoff

Secret values must be entered through the deployment provider or local secret
store and must never be pasted into this document or committed to Git. Codex
will provide the authoritative variable names, validation commands, and minimum
permissions before each group is needed.

Expected user-provided categories:

- Production and staging PostgreSQL connection credentials.
- R2 endpoint, bucket names, and least-privilege access credentials.
- Journal ticket signing key and control/projection secrets.
- Public API, WebSocket, asset, and update-service domains.
- OAuth application credentials for enabled providers.
- Stripe keys, prices, and webhook secrets if billing ships in beta.
- Email delivery credentials if transactional email ships in beta.
- Telemetry/crash-reporting project credentials if enabled.
- Apple signing/notarization credentials and team identifiers.
- Windows code-signing provider credentials.
- Tauri updater signing key supplied to CI through its secret store.

## Deferred until after public beta

- [ ] Bundle splitting and deep performance work beyond the agreed launch
  budgets.
- [ ] Broad refactors that do not reduce release risk.
- [ ] Two-factor authentication and advanced active-session management unless
  required by beta risk review.
- [ ] Mobile public release unless explicitly added to the beta scope.
- [ ] Unfinished Agents and integrations not included in the public-beta
  promise.
