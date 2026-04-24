# Public beta product surface

The public beta includes account/profile/authentication, Spaces and membership,
Chat, Journal notes/drawings, direct R2-backed Journal/Library assets, Agents,
the three user-controlled cloud connections, billing/entitlements when live
mode is configured, updates, diagnostics, data export, and account deletion.

Agents are reusable definitions and first-class, permissioned Space members.
The Agents destination is management-only; all interaction happens through
normal Space Conversations, assignments, mentions, or enabled automations.
Files and Transfers additionally require an expiring per-user, per-device
grant. The first-class model ships only with the coordinated minimum desktop,
server, and database version; no Agent Dock or private-session fallback exists.

Action suggestions are an owner-enabled, participant-vetoable enhancement to
human conversations. Misty performs neutral detection but is never an Agent
identity. A suggestion is shared conversation UI, not a message, and cannot
execute until a member reviews every selected action, chooses an eligible
participating Agent, and accepts the exact payload. Private conversations may
create only conversation-scoped resources and native Misty calendar events.

The API is the feature boundary:

- Unsupported integration provider names are absent from the OAuth catalog and
  rejected by tests.
- Journal collaboration fails closed when its complete signing/Worker
  configuration is absent; it does not silently acknowledge local-only edits.
- Journal assets reject proxy upload/download and unsafe active MIME types.
- Production rejects local/in-memory Library storage.
- Demo reset/internal routes require their explicit non-production
  configuration.
- Optional media/vision processors remain unavailable unless their validated
  executable/endpoint is configured.
- Mobile public release, two-factor authentication, advanced session
  management, and any UI marked “Coming soon” are not part of the beta promise.

Adding a beta feature requires an authenticated API route, authorization and
rate-limit tests, failure/offline behavior, environment validation, and an
entry in the acceptance matrix.
