# Public beta product surface

The public beta includes account/profile/authentication, Spaces and membership,
Chat, Journal notes/drawings, direct R2-backed Journal/Library assets, Agents,
the three user-controlled cloud connections, billing/entitlements when live
mode is configured, updates, diagnostics, data export, and account deletion.

Agents in beta are contextual teammates in Files and Spaces. The
`agent_teammates_v1` client rollout is controlled by
`VITE_AGENT_TEAMMATES_V1=true`; production must deploy the backward-compatible
server migration before enabling the client flag. Legacy `/agents` and
`/assistant` links remain compatible and open the contextual Agent dock.
Device job execution, folder agents, and document intelligence remain separate
`VITE_MISTY_*` capabilities in `src/features/agents/flags.ts`.

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
