# Space Agents production deployment

Misty exposes one Agent product: creator-authored Space Agents. Each member's conversations, credentials, workflow settings, runs, approvals, memory, cursors, and results remain isolated behind the internal `AgentInstance` record.

## Launch integrations

The visible production catalog is Google Calendar, Slack, Discord, and Notion. Google Calendar and Notion are read/watch only. Slack and Discord use official bot identities, and every outbound reply requires a fresh per-action approval. Provider callbacks are private infrastructure; Misty does not offer a generic inbound endpoint.

Configure the complete HTTPS API base (including `/api` or a versioned replacement), desktop OAuth return, encryption key, and provider credentials described in the desktop repository's `docs/UNIFIED_AGENT_PLATFORM_OWNER_INPUTS.md`. Tokens stay in the encrypted server credential vault and must never appear in prompts, workflow definitions, callback URLs, or logs.

Discord requires the official bot token and Message Content Intent for full-message launch behavior. Without that intent, the integration reports `message_content_intent_missing` in Needs attention. It must not silently treat absent content as an empty message.

## Cutover

1. Back up PostgreSQL.
2. Apply migrations through `20260902000000_space_tasks_calendar_launch.sql`.
3. Verify the production callback origin and OAuth redirects.
4. Start the server worker and confirm Google watch renewal/reconciliation and Discord Gateway health.
5. Complete the two-user acceptance checklist in the owner-input document.

Migration `20260831000000_unified_agent_workflows_v2.sql` preserves valid Space Agents and backfills immutable Agent versions. It drops only the retired device/folder runtime tables and removes standalone legacy Workflow runs. It does not delete Spaces, chats, Libraries, ordinary files, provider connections, trusted devices, or valid Space Agent conversations.

## Release verification

- Run `go test . ./agent ./api ./workflow`.
- Run database integration tests against a disposable migrated PostgreSQL instance.
- Verify task permissions, optimistic updates, assignment, archival, realtime updates, and Agent/run provenance.
- Verify Google full and incremental sync, watch renewal, dropped callback repair, cancellation, timezone/DST handling, revocation, and absence of Google writes.
- Verify Slack signatures, replay rejection, event deduplication, channel-loss handling, approval expiry, posting reconciliation, and uninstall behavior.
- Verify Discord heartbeat/resume, sequence persistence, reconnects, intent degradation, permission changes, rate limits, approved replies, and bot removal.
- Verify Notion OAuth, resource selection, recursive pagination, signed change events, reorder tolerance, deletion, revoked access, and citations.
- Prove two members can use the same Space Agent without sharing conversations, credentials, cursors, memory, approvals, or results.
- Confirm images and image-only PDF pages return `unsupported_content`; the launch has no optical text extraction path.

Never log or paste OAuth secrets, bot tokens, signing secrets, provider access/refresh tokens, desktop signing keys, or approval payloads into support tickets.
