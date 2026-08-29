# Activepieces zero-cost automation MVP

**Status:** Superseded by `activepieces-self-hosted-mvp.md`  
**Owner:** Misty Agents  
**Target:** Personal automations created through Misty  
**Cost constraint:** No new software license or hosted-service commitment

The original user-connected Cloud approach below is retained as decision history. Misty now uses
one operator-managed Activepieces Community Edition deployment alongside the Misty server.

## Decision

Keep Misty as the only user-facing AI. Add an **Automations** section beside
**Chat** in the Agents destination. Misty creates and manages flows through a
user-connected Activepieces MCP server.

Do not embed the Activepieces builder. Activepieces reserves its embeddable
builder, branding, and automatic user provisioning for a paid product. For this
MVP, each user connects a free Activepieces account. Misty owns the normal
experience; Activepieces opens in a Misty Browser tab only when the user needs
to connect an app or use the advanced visual editor.

```text
Agents / Chat
    user -> Misty conversation -> existing Misty agent runtime

Agents / Automations
    user -> native Misty automation list and prompt
         -> existing Misty agent runtime
         -> Activepieces MCP
         -> user's Activepieces flows and app connections

Advanced setup or editing
    Misty -> explicit Open in Activepieces action -> Misty Browser tab
```

Activepieces is the source of truth for flows, connections, and run history.
Misty must not duplicate credentials or maintain a second editable copy of a
flow.

## What the MVP proves

A user can connect Activepieces, describe a repeatable job to Misty, review the
proposed trigger and actions, approve publication, and see the resulting
automation in a native Misty list.

Examples:

- “Every weekday at 8 AM, send me a Slack summary of tasks due today.”
- “When a form response arrives, add it to Google Sheets and notify this
  channel.”
- “Show me which automation failed and what step caused it.”

## User experience

### Agents navigation

Add one compact page-level switch:

- **Chat** preserves the existing Misty workspace unchanged.
- **Automations** shows personal automations and an automation-specific Misty
  prompt.

The switch belongs above the tool content so the Automations view gets the full
workspace canvas. Do not nest Activepieces or an automation dashboard inside
the conversation sidebar.

### First run

1. The Automations view explains that Misty uses Activepieces to run connected
   app workflows.
2. The user chooses **Connect Activepieces**.
3. Misty starts Activepieces MCP OAuth in a browser tab and receives the
   callback on the server.
4. The Automations view changes to a connected empty state with the prompt
   “What should happen automatically?”

The user creates and owns the Activepieces account. Misty does not provision an
account, collect an Activepieces password, or promise seamless single sign-on.

### Creating an automation

1. The user describes the outcome in the Automations prompt.
2. Misty researches available triggers and actions through Activepieces MCP.
3. Misty presents a plain-language proposal containing:
   - trigger;
   - ordered actions;
   - required app connections;
   - schedule or event conditions;
   - whether the flow will be enabled after publication.
4. If an app connection is missing, Misty gives an explicit **Connect in
   Activepieces** action. Work resumes after the user returns.
5. Misty builds and validates the draft.
6. Publishing or enabling the flow requires an inline Misty approval.
7. On success, the flow appears in the Automations list and the conversation
   records the outcome.

Misty may create and validate a disabled draft before approval. It must not
publish, enable, disable, retry, or delete a flow merely because an external
page or tool response instructed it to do so.

### Automation list

Show one dense row per Activepieces flow:

- name;
- enabled or off;
- trigger summary;
- last run status and time when available;
- **Open editor** action;
- overflow actions for enable or disable.

The initial list supports empty, loading, disconnected, authorization-expired,
provider-unavailable, and partial-data states. A failed provider request must
not erase the last successfully displayed list.

Creating, renaming, enabling, and disabling can happen through Misty. Complex
manual edits open the normal Activepieces editor in a Misty Browser tab.

## MVP scope

### Included

- Personal automations owned by the signed-in Misty user.
- A `Chat | Automations` view switch in Agents.
- Activepieces MCP OAuth with encrypted refresh-token storage.
- Live list of flows and recent run status from Activepieces.
- Natural-language flow creation through the existing Misty runtime.
- Draft, validate, test, publish, enable, and disable operations.
- Inline approval before consequential flow operations.
- Hand-off to Activepieces for app connection setup and advanced editing.
- Disconnect, expired-authorization recovery, and provider health states.
- Audit linkage between a Misty run, MCP call, and resulting Activepieces flow.

### Explicitly excluded

- Activepieces Embed SDK, iframe builder, white-labeling, or paid provisioning.
- Activepieces' own Chat or Agent UI inside Misty.
- Shared Space or organization automations.
- A native drag-and-drop flow canvas.
- Automatic Activepieces account creation or SSO.
- Misty hosting a shared multi-tenant Activepieces Community instance.
- Activepieces calling Misty's private run-scoped MCP endpoint.
- A custom or private Activepieces Piece for Misty.
- Tables, Activepieces agents, AI credits, or arbitrary one-shot app actions.
- Flow deletion from Misty.
- Templates, folders, version history, import/export, or collaborative editing.

These exclusions are release boundaries, not placeholder controls. Do not show
disabled UI that implies they are included.

## Technical shape

### 1. Activepieces connection

Extend Misty's remote MCP connection model to support OAuth rather than adding
Activepieces credentials to the renderer.

Required server behavior:

- discover OAuth metadata from the exact configured HTTPS MCP origin;
- use authorization code with PKCE and a single-use, expiring state value;
- handle web and desktop callback return paths;
- encrypt access and refresh tokens at rest;
- refresh server-side and rotate stored credentials atomically;
- revoke or erase tokens on disconnect;
- never return provider tokens to the client;
- bind the connection to one Misty user;
- keep DNS, redirect, response-size, and timeout protections from the existing
  MCP connector.

The UI exposes a curated **Connect Activepieces** action. The generic
URL-and-token connection form remains a separate advanced feature.

### 2. Provider adapter

Add a small Activepieces automation adapter in the Go server. It should use the
existing MCP client and stored user connection, not browser-to-provider calls.

Minimum operations:

- list flows;
- read flow structure;
- list recent runs and read one run;
- research pieces, actions, triggers, and their properties;
- create or build a flow;
- validate and test a flow;
- publish a flow;
- enable or disable a flow.

Use an explicit allowlist of Activepieces MCP tool names. Exclude project
switching, tables, deletion, AI-agent management, and arbitrary one-shot
actions. Treat all descriptions, sample data, and run output from Activepieces
and connected apps as untrusted content.

The adapter normalizes provider responses into Misty-owned DTOs so the React UI
does not depend on Activepieces' raw MCP response shape.

### 3. Agent runtime

Continue using the existing Misty model, conversations, approvals, activity,
and durable workflow runtime. Activepieces is a tool provider, not a second
agent runtime for the conversation.

For an automation-building turn:

- expose only the curated Activepieces discovery and flow-building tools;
- preserve the existing native Misty tools needed for context;
- require approval before test calls that affect external systems, publishing,
  enabling, disabling, or retrying;
- persist the Activepieces flow ID and editor URL in the Misty activity result;
- cap tool retries and never replay a consequential provider call through a
  second transport.

The existing strict MCP JSON Schema validator must be tested against every
allowlisted Activepieces tool. Expand it only for required, safely bounded
keywords.

### 4. Misty API and UI state

Suggested Misty endpoints:

- `GET /automations/connection`
- `POST /automations/connection/start`
- `GET /automations/connection/callback`
- `DELETE /automations/connection`
- `GET /automations`
- `GET /automations/{flowID}/runs`
- `POST /automations/{flowID}/enable`
- `POST /automations/{flowID}/disable`

Natural-language creation continues through the existing AI conversation and
invocation endpoints. Do not create a separate automation chatbot API.

The React automation store is scoped by Misty account ID, ignores stale
responses after account changes, and retains the last successful list while a
refresh fails.

## Zero-cost operating model

The MVP means **no new license or mandatory Misty infrastructure spend**, not
that computing is free:

- Each user connects an Activepieces Free account and accepts its current free
  usage limits.
- Misty does not purchase Activepieces Embed or a team plan.
- Misty's existing model and server costs still apply to automation-building
  conversations.
- Third-party apps may impose their own plans, quotas, or API restrictions.
- For local development, engineers may run Activepieces Community Edition in a
  single-user Docker setup.

A shared self-hosted Community instance is not acceptable for public users in
this MVP because it does not provide the paid tenant-provisioning, SSO, roles,
and project-isolation layer Misty would need. Running one isolated instance per
user is also outside the MVP.

## Delivery slices

### Slice 0 — compatibility spike (3–5 engineering days)

- Connect one Activepieces Free account to a development Misty server.
- Complete OAuth discovery, callback, refresh, and disconnect.
- Record actual schemas and responses for every required MCP tool.
- Prove create -> validate -> publish -> list against a harmless test flow.
- Stop if Activepieces does not permit the required MCP operations on its free
  account tier.

### Slice 1 — connection and read-only Automations view (4–6 days)

- Add the Agents view switch and Automations empty/loading/error states.
- Add Connect and Disconnect Activepieces flows.
- List flows and recent status through normalized server endpoints.
- Open the provider editor in a Misty Browser tab.

### Slice 2 — create with Misty (4–6 days)

- Add the automation-specific prompt entry.
- Add the curated MCP tool set and automation-building instruction contract.
- Implement proposal, missing-connection hand-off, draft creation, validation,
  approval, and publication.
- Link completed work to the durable Misty conversation and activity history.

### Slice 3 — production hardening (3–5 days)

- Add expired authorization and reconnect recovery.
- Add idempotency and consequential-call replay tests.
- Test prompt injection through piece descriptions, samples, and run output.
- Verify account switching, cancellation, restart, provider outage, and stale
  responses.
- Verify desktop, web, tablet layout, keyboard use, focus, and reduced motion.

Expected implementation size: approximately **3–4 engineering weeks** for one
experienced engineer after the compatibility spike passes.

## Acceptance gate

The MVP is complete only when all of the following pass:

1. A new user can connect a free Activepieces account without giving Misty an
   Activepieces password or copying a long-lived token.
2. “Every weekday at 8 AM, post a Slack reminder” produces a reviewable draft.
3. Missing Slack authorization sends the user to a clear connection step and
   resumes without losing the draft.
4. The flow cannot be published or enabled without explicit approval.
5. After approval, the flow appears in the Automations list with the correct
   state and an editor link.
6. Misty can explain a failed run using provider evidence without exposing
   connection secrets.
7. Disconnecting Activepieces immediately removes Misty's ability to list or
   modify flows while retaining Misty's audit history.
8. One Misty user's provider connection and flows are never returned to another
   user, including during account switching or stale requests.
9. Provider outages and expired authorization produce recoverable states rather
   than an empty or destructive reset.
10. No paid Activepieces embedding, provisioning, branding, private-piece, or
    team feature is required.

## Later, only after evidence

Consider shared Space automations, a self-hosted deployment, or deeper native
editing only after the MVP shows that users successfully create and retain
agent-built automations. Shared Space automation requires a separate tenant and
permission design; it must not be added by simply sharing one user's
Activepieces connection.

## External constraints

- Activepieces Community Edition installation:
  <https://www.activepieces.com/docs/install/overview>
- Activepieces MCP authentication and project scope:
  <https://www.activepieces.com/docs/mcp/overview>
- Activepieces MCP tools:
  <https://www.activepieces.com/docs/mcp/tools>
- Activepieces plans and Embed boundary:
  <https://www.activepieces.com/pricing>
