# Public beta product surface

The public beta includes account/profile/authentication, Spaces and membership,
Chat, Journal notes/drawings, direct R2-backed Journal/Library assets, the
shipping Agent/runtime paths, the three user-controlled cloud connections,
billing/entitlements when live mode is configured, updates, diagnostics, data
export, and account deletion.

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
