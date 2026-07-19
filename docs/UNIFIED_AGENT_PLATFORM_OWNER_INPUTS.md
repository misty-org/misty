# Misty July 27 Launch: Owner Inputs and Acceptance Checklist

**Updated:** July 18, 2026  
**Release target:** July 27, 2026  
**Applies to:** Misty desktop and `misty-server`

This document is the complete list of owner-controlled inputs needed to accept the July 27 Space Agents and Coordination release. Never put secret values in this file, source control, chat, tickets, workflow definitions, or Agent prompts. Put secrets directly in the production secret manager.

## 1. Final launch scope

Misty has one Agent product: a **Space Agent**.

- A Space Agent definition and its published versions belong to one Space.
- Its creator alone edits and publishes it.
- Every Space member may use it by default, unless its creator restricts access.
- Agent Center displays the current member's conversations, enabled workflows, connections, credentials, memory, cursors, runs, approvals, and results for that shared Agent.
- Those usage records are isolated per member and remain internal runtime state; members do not create a second kind of Agent.
- Studio authors shared definitions. Agent Center manages the current member's use of them.

The July 27 coordination scope is:

- Space Tasks with assignment, status, due dates, optimistic updates, archive, filters, realtime events, and Agent/run provenance.
- A Space Calendar view combining due tasks with published Google Calendar events.
- Read-only Google Calendar synchronization.
- Slack selected-channel read/watch and individually approved Misty bot replies.
- Discord selected-channel read/watch and individually approved Misty bot replies.
- Notion selected-resource read/watch.

The launch does not include other providers, Obsidian, OCR, generic inbound webhooks, custom Misty callback URLs, two-way calendar sync, Google Calendar writes, or Notion writes.

## 2. Inputs required immediately

All items in this section block live provider acceptance.

### Public infrastructure

- [ ] Stable production HTTPS API base, including its path/version, such as `https://mistysys.com/api`.
- [ ] Stable public app/web origin.
- [ ] Desktop OAuth completion page copy and branding approved.
- [ ] A continuously running server/worker deployment. Discord Gateway cannot run on a request-only or scale-to-zero service.
- [ ] Production database migration owner and backup/cutover window.
- [ ] Production secret manager and the person responsible for adding and rotating secrets.
- [ ] Logs, traces, alerting destination, and on-call contact.

### Public identity and provider review

- [ ] Public app name and publisher/legal name.
- [ ] Square app icon, preferably a 1024×1024 source.
- [ ] Public website and support contact.
- [ ] Privacy-policy URL.
- [ ] Terms-of-service URL.
- [ ] Account/data-deletion instructions URL.
- [ ] Short and long app descriptions.
- [ ] Approved explanation that selected provider content may be sent to the configured LLM to answer user requests.
- [ ] Approved statement about model training, retention, subprocessors, and hosting regions.

### Live acceptance environment

- [ ] At least two Misty test users.
- [ ] One shared Space containing both users.
- [ ] Permission to execute test bot replies.
- [ ] Provider-console access for the engineer performing acceptance.
- [ ] Representative calendars, Slack channels/threads/files, Discord channels/threads/files, and Notion pages/data sources.
- [ ] At least one resource visible to only one test user, to prove isolation and ACL behavior.

## 3. Production URLs

Provide:

```text
MISTY_PUBLIC_API_URL=https://mistysys.com/api
MISTY_APP_URL=https://________________________________
```

`MISTY_PUBLIC_API_URL` is the complete API base—not merely the web origin. The server and frontend build share this exact variable. A future value such as `https://mistysys.com/api/v2` is preserved without appending another `/api` segment. The older frontend-only variables `VITE_MISTY_SERVER_URL` and `VITE_API_BASE` remain compatibility fallbacks and should not be used for new deployments.

Production monitoring should query `{API_BASE}/health`. The public response is
sanitized and never includes secrets, account identities, database addresses, or
provider tokens. PostgreSQL, Library storage, and realtime are active critical
checks and return HTTP `503` when unavailable. Optional service/provider gaps
return HTTP `200` with an overall `degraded` status and per-service details.

Misty shows a browser completion page after OAuth succeeds. The page must not carry access tokens or provider secrets.

Register these OAuth redirects exactly:

```text
{API_BASE}/oauth/providers/google/callback
{API_BASE}/oauth/providers/slack/callback
{API_BASE}/oauth/providers/discord/callback
{API_BASE}/oauth/providers/notion/callback
```

Configure these private provider event receivers:

```text
{API_BASE}/provider-callbacks/google/calendar
{API_BASE}/provider-callbacks/slack-events
{API_BASE}/provider-callbacks/notion-events
```

Discord messages arrive through the long-lived Gateway worker. Misty does not expose a Discord webhook trigger or a custom inbound endpoint.

For the initial Notion webhook handshake only, set
`NOTION_WEBHOOK_LOG_VERIFICATION_TOKEN=true`, deploy, and use **Resend token**
in Notion. Copy the `MISTY_NOTION_WEBHOOK_VERIFICATION_TOKEN=...` value from
restricted server logs into `NOTION_WEBHOOK_VERIFICATION_TOKEN`, remove the
temporary logging flag, restart, and delete or expire the sensitive log entry.

## 4. Google Calendar

### Owner actions

- [ ] Create or select a Misty-owned Google Cloud project.
- [ ] Enable Google Calendar API.
- [ ] Configure the OAuth consent screen with Misty's public identity and policy URLs.
- [ ] Verify the production domain.
- [ ] Create a Web application OAuth client.
- [ ] Register the exact Google Calendar redirect URI.
- [ ] Configure production/test OAuth audiences and test users.
- [ ] Complete Google verification if requested for the read-only scopes.
- [ ] Create two test calendars containing timed events, all-day events, recurring events, cancellations, different timezones, and DST boundaries.

### Required secrets

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

### Acceptance result

- The user connects with read-only Calendar and identity scopes plus offline access.
- The user previews calendars and explicitly publishes selected calendars to a Space.
- Misty performs initial full sync, then incremental sync-token reconciliation.
- A renewable watch channel exists per published calendar.
- A notification triggers reconciliation; it is not treated as a complete event payload.
- Periodic repair sync recovers a dropped notification.
- Created, updated, and canceled events appear in the Space Calendar with timezone-correct ranges.
- Misty never writes an event, RSVP, cancellation, or other change back to Google.
- Revocation disables the source and produces a Needs attention item.

## 5. Slack

### Owner actions

- [ ] Create a Misty-owned Slack app.
- [ ] Configure OAuth and the exact redirect URI.
- [ ] Configure the Events API callback URL.
- [ ] Subscribe only to the launch message, mention, thread, edit, delete, file, and reaction events.
- [ ] Configure bot scopes for selected-channel discovery, history, files, mentions, and posting.
- [ ] Install the app in a test workspace.
- [ ] Invite the bot explicitly to each private test channel.
- [ ] Provide public and private channels, a thread, edited/deleted messages, a file, a mention, and a reaction.

### Required secrets

```text
SLACK_CLIENT_ID
SLACK_CLIENT_SECRET
SLACK_SIGNING_SECRET
```

### Acceptance result

- Only channels explicitly selected by an integrations manager are published into the Space.
- Callback signatures and five-minute replay protection are enforced on the raw body.
- Slack receives an immediate acknowledgement and processing occurs asynchronously.
- Duplicate `event_id` deliveries do not duplicate normalized records or workflow triggers.
- Agents can read, summarize, draft, and cite selected-channel content.
- Every post/reply pauses for an exact per-action approval, even when a workflow has other pre-authorized writes.
- The approval identifies the Agent, run/workflow, Slack installation, Misty bot, channel/thread, exact text, citations, and expiration.
- Channel access is revalidated immediately before posting.
- The returned Slack message timestamp is journaled for reconciliation.
- Losing channel access or uninstalling the app produces Needs attention.

## 6. Discord

### Owner actions

- [ ] Create one official Misty Discord application and bot.
- [ ] Configure the OAuth/install redirect and install URL.
- [ ] Enable only the required guild, guild-message, reaction, and Message Content intents.
- [ ] Obtain approval for the privileged Message Content Intent if Discord requires it.
- [ ] Install the bot in a test guild.
- [ ] Supply selected test channels, a thread, edits/deletions, attachments, mentions, and reactions.
- [ ] Confirm the bot may read channel history and post messages in selected channels.

### Required secrets

```text
DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET
DISCORD_BOT_TOKEN
```

### Release blocker

Full-message launch acceptance requires Message Content Intent. If it is unavailable by July 27, the integration reports `message_content_intent_missing` and is degraded; it does not silently return empty content. That degraded state does not satisfy the agreed full-message release requirement.

### Acceptance result

- Misty never accepts a Discord user token and never performs self-bot automation.
- Only selected guild channels are published to the Space.
- The Gateway worker heartbeats, persists sequence/session/resume URL, resumes after disconnect, deduplicates dispatches, and backs off on repeated failures.
- Messages, mentions, threads, edits, deletions, reactions, and readable attachments normalize into cited records.
- Missing Message Content capability appears in Needs attention.
- Every reply requires an exact per-action approval and posts as the Misty bot.
- Destination access is revalidated immediately before posting.
- The approving Misty member and Discord message ID are recorded in the action journal.

## 7. Notion

### Owner actions

- [ ] Create a public Misty Notion connection.
- [ ] Configure the exact OAuth redirect URI.
- [ ] Configure the connection webhook callback.
- [ ] Complete webhook verification and place the verification token in the secret manager.
- [ ] Pin and approve Notion API version `2026-03-11` for launch.
- [ ] Share representative pages, databases/data sources, nested blocks, and attachments with the connection.
- [ ] Include restricted and deleted content in the test workspace.

### Required secrets

```text
NOTION_CLIENT_ID
NOTION_CLIENT_SECRET
NOTION_WEBHOOK_VERIFICATION_TOKEN
```

### Acceptance result

- OAuth follows the public connection flow.
- Users may publish only resources already shared with and returned by the Notion connection.
- Webhook HMAC verification runs against the raw request body.
- Duplicate event IDs are ignored; aggregation and reordering are tolerated.
- Every signal fetches the latest object rather than trusting the event as complete content.
- Reading supports metadata, bounded block pagination, attachments, normalized references/pages, and citations.
- Selected Notion content is available to Agents and workflows but is not copied into the Space Library.
- Notion remains read/watch only.

## 8. Space Tasks and Calendar acceptance

- [ ] `tasks.view`, `tasks.manage`, and `integrations.manage` are granted to `@everyone` in new and existing Spaces.
- [ ] Owners can restrict those permissions through roles/overrides.
- [ ] List filters cover status, assignee, due date, and assigned-to-me.
- [ ] Calendar view combines due tasks and imported Google events.
- [ ] Create/edit shows source references and Agent/run provenance.
- [ ] Concurrent edits produce an optimistic-version conflict instead of overwriting.
- [ ] Assignment is limited to current Space members.
- [ ] Completion, cancellation, and archival create realtime Space events.
- [ ] Ad hoc Agent task creation/update requires approval.
- [ ] An exact enabled workflow may pre-authorize low-risk task creation for one Space.
- [ ] Destructive and bulk task changes always require Needs attention approval.

## 9. Security and multi-user acceptance

- [ ] Only shared Space Agents appear in Studio, Agent Center, navigation, search, and chat.
- [ ] Creator-only editing and publication is enforced server-side.
- [ ] Agent access restrictions exclude non-allowed Space members.
- [ ] Two members use the same Space Agent without sharing conversations, memory, credentials, workflow cursors, approvals, runs, or results.
- [ ] OAuth state is single-use, expires, and is bound to user, Space, provider, PKCE verifier, and return destination.
- [ ] The provider callback succeeds without a desktop bearer session and stores the credential only for the user recorded in state.
- [ ] Tokens never appear in URLs, workflow graphs, Agent prompts, browser storage, logs, or another member's response.
- [ ] Publishing a provider source exposes only normalized selected content, never the installer's OAuth credential.
- [ ] Callback signatures, replay windows, event deduplication, retries, rate limits, revocation, renewal, and reconciliation are tested.
- [ ] Slack/Discord reply approval cannot be bypassed by workflow pre-authorization.
- [ ] Retries cannot duplicate Space tasks or outbound bot messages.

## 10. Cutover checklist

### Engineering completion

- [x] Product/UI uses Space Agent terminology and `agentId` routing.
- [x] Space Task and Calendar contracts, permissions, APIs, realtime events, and desktop surface exist.
- [x] Google Calendar publishing, full/incremental synchronization, watch callback, renewal metadata, and repair reconciliation paths exist.
- [x] OAuth callbacks consume single-use state without requiring a desktop bearer session.
- [x] Visible provider catalog is limited to Google Calendar, Slack, Discord, and Notion.
- [x] Slack signed event intake, deduplication, normalized content, and selected-channel enforcement exist.
- [x] Discord Gateway heartbeat/resume state, selected-channel enforcement, normalized content, and degraded intent health exist.
- [x] Notion signed event intake, latest-object fetch, bounded pagination, and selected-resource enforcement exist.
- [x] Slack and Discord writes are restricted to selected channels and exact per-action approval.
- [x] Workflow and ordinary Agent tools can query tasks/calendar and create/update tasks with provenance.
- [x] OCR and generic inbound webhook product paths are excluded.

### Owner/deployment completion

- [ ] All production URLs and legal pages are live.
- [ ] All four provider applications are configured and owned by Misty.
- [ ] All secrets are stored in the production secret manager.
- [ ] Database backup and migration window are approved.
- [ ] Provider callbacks are reachable over production HTTPS.
- [ ] Discord worker deployment is continuously running.
- [ ] Two-user live fixtures are ready.
- [ ] Provider review/verification requirements are complete.
- [ ] Discord Message Content Intent is enabled and accepted.
- [ ] Live provider acceptance and outage/revocation tests pass.
- [ ] Security review and scoped migration validation pass.

### Scoped migration validation

- [ ] Valid `space_agents` and immutable versions remain intact.
- [ ] Spaces, members, chats, Libraries, ordinary files, and provider connection records remain intact.
- [ ] Only known legacy Agent records/tables are removed.
- [ ] No migration recursively deletes a Library root or ordinary user directory.

## 11. Owner response template

Copy this section into a private planning document. Include only non-secret identifiers.

```markdown
# Misty July 27 Owner Response

## Public identity
- Legal publisher:
- Public app name:
- Website:
- Support email:
- Security email:
- Privacy policy URL:
- Terms URL:
- Data deletion URL:
- Brand asset location:

## Infrastructure
- Production API base, including `/api` or its versioned replacement:
- App/web origin:
- Desktop OAuth return behavior:
- API/worker hosting project:
- Secret manager/project:
- Production region:
- Log/trace platform:
- Alert/on-call contact:
- Database migration owner:
- Backup and cutover window:

## Provider ownership (identifiers only)
- Google Cloud project and owner:
- Slack app ID and test workspace:
- Discord application ID and test guild:
- Notion connection ID and test workspace:

## Test setup
- Misty test user A:
- Misty test user B:
- Shared Space:
- Google test calendars:
- Slack selected channels:
- Discord selected channels:
- Notion selected resources:
- Permission to execute bot replies: yes / no

## Data policy
- Raw event retention:
- Normalized provider content retention:
- Run/trace retention:
- Agent conversation retention:
- Agent memory retention:
- Provider content may be sent to configured LLM: yes / no
- Provider content used for model training: yes / no
- Approved hosting/subprocessor statement:

## Secret delivery
- Secrets were added to:
- Rotation owner:
- Secret values are not included here.
```

Owner inputs are complete only when every owner/deployment checkbox above is satisfied. Code completion alone cannot prove live OAuth review status, callback reachability, provider ACL behavior, Discord privileged-intent access, or multi-user isolation against real provider tenants.
