# Agent architecture — approved direction

Approved by the owner on October 4, 2026. This brief replaces the earlier agent
workflow plan: its small enforced allowlist, up-front work-location choice,
single explicitly selected Composio tool and single-step server-side Midscene
planner are gone. That plan's security invariants are listed below and still
apply.

## Goal

One sentence should be enough. For example:

> check spaces, gather my two latest notes and upload them to my google drive
> and move them to a folder called "misty space notes"

Misty reads the request, plans, uses Misty data, connected apps and the screen as
needed, and reports verified results. It does not ask the user to pick a mode,
restate the task, or name tools. When the work needs a screen, the user can watch
a cursor move, click, open tabs and search like a person.

The engineering goal is that **no Misty-side gate decides what the agent may do
before the model reads the request.** Capabilities are limited only by the
owner's account permissions, the physical availability of a device or screen,
and the approval policy below.

## Principles

1. **Decide after reading.** No keyword intent compilers, regex mode switches or
   per-agent allowlists. The model plans with every tool the run can use.
2. **One catalog per run.** The tools listed to the model, the tools the gateway
   authorizes and the tools that execute come from one function. Prompts are
   generated from that catalog, so they never promise a missing tool.
3. **Real tool names.** The model sees `notes_search`, not `capability_15`.
4. **Screens on demand.** A run opens a screen only when its plan needs one. Where
   it opens is an account setting the user's words can override.
5. **Composio for apps, Midscene for screens.** Misty does not write per-app
   integrations or click logic.
6. **Misty owns the platform:** its own data tools, the device adapter, the
   policy gate, the action journal and billing.

## Architecture

```
Composer (one input, no modes)
  └─ Agent loop (Vercel Workflow; plans, picks API or screen)
       └─ Capability gateway (Go: catalog · policy/approvals · journal · billing)
            ├─ Misty data tools — notes, tasks, calendar, drawings, roadmaps,
            │  library, messages, memory; optional `space` argument
            ├─ Composio session — per Misty user; search, connect, execute
            └─ Screen tasks — screen.open / screen.act / screen.read
                 └─ Desktop host — Midscene Agent.aiAct + device adapter,
                    visible cursor, Stop, inline approvals
```

- **Agent loop.** One durable loop for every entry point (panel, Agents page,
  companion, voice). All tools are active on every turn.
- **Capability gateway.** Resolves the run's catalog, authorizes each call with
  the owner's account and Space permissions, applies the approval policy,
  journals effects and meters usage. MCP is only its transport to the runtime.
- **Misty data tools.** Flat, account-level tools. Reads cover every Space the
  owner can access unless a `space` is given; writes default to the owner's
  personal Space. `spaces_list` remains for naming destinations. Runs that
  belong to a Space (Space conversations and runs started inside a Space) act
  in that Space and follow the member's permissions there.
- **Composio.** One session per Misty user, created and proxied by Go through
  the REST v3.1 session API (`/api/v3.1/tool_router/session…`). The model uses
  Misty's own `apps_search`, `apps_schemas`, `apps_connected`, `apps_connect`
  and `apps_execute` tools, so the gateway sees every tool slug before it runs.
  Connect Links become an in-chat "Connect Google Drive" card, and the
  connecting call waits while the user signs in. The remote workbench and bash
  tools stay disabled until the gateway can authorize what they run.
- **Screen tasks.** `screen.act(goal)` is one device job per goal, not one per
  click. The desktop runs Midscene's agent loop against a device adapter for the
  Misty window, the agent window or the full desktop. Midscene's model calls go
  through a Go vision proxy with their own meter.

## Policy

Every action is classified as read, create, update, consequential or
destructive, using Composio's tool tags, Misty descriptor risk and Midscene's
stop-before-irreversible instruction. One account setting controls autonomy.

- Reads, and creates or updates the user explicitly asked for, run without a
  prompt.
- Sending to other people, publishing, purchasing, sharing, changing access and
  deleting require approval unless the account setting allows them.
- Read-only failures are retryable. They are never reported as "may have
  happened" and never end a run.
- A call Misty rejected without effect (invalid arguments, an unknown Space, an
  unavailable tool) returns its error to the model, which corrects the call. The
  rest of that model response is skipped and reported as not attempted. Repeating
  an identical rejected write ends the run.
- A write whose outcome is unknown, a denied approval, an unavailable device or
  a required sign-in ends the run until the user resolves it.

These invariants from the earlier plan remain:

- The server checks every operation, including operations inside batch or proxy
  tools. Prompt instructions are not a security boundary.
- Every effect is journaled with an idempotency key; uncertain outcomes are
  reconciled before retry.
- Page content, tool results and messages from other agents never grant
  authority or impersonate the owner.
- No unrestricted shell or host code execution.
- Device control requires a live, user-owned lease that Stop revokes at once.
- Third-party app tokens keep their scoped authority.

## Phases

Each phase leaves the product working.

### Phase 1 — Unblock the agent (implemented and verified live October 4, 2026)

- Delete keyword intent compilation, required-tool derivation, conversation
  focus and pending-action heuristics, send-overlap grounding, mutation-target
  grounding and keyword memory gates.
- Delete the personal-agent allowlist and agent workspace-app gating. Keep
  physical constraints: browser tools need an attached browser; screen control
  needs the agent's window lease.
- One catalog per run: the MCP server advertises exactly the run's resolved
  toolbox. Remove the parallel static registry.
- Flat data tools with an optional `space`; remove `spaces.tools` and
  `spaces.execute`.
- Generate prompts from the catalog.
- Runtime: real tool names, every tool active, no capability discovery tool or
  keyword working set, no required-tool completion gate. Split the workflow file
  by responsibility.
- Read-only browser failures become retryable. Midscene planning no longer
  consumes the run's model-turn limit.

### Phase 2 — Composio sessions (implemented and verified live October 4, 2026)

- Gateway-owned Composio sessions reaching every toolkit, connect cards and
  policy on each tool slug. Done; see
  [deploy/composio/README.md](../../../server/deploy/composio/README.md).
- The calendar-only adapter and its per-agent calendar binding are deleted.
  Connected apps belong to the account and every agent inherits them.
- Connect and approval cards hold the calling tool for up to 40 seconds. If the
  user has not answered by then, the run hands off with the card in the chat,
  and the desktop continues the conversation once the app is connected or the
  action approved (the card checks for a finished sign-in).
- One account setting, *Ask before acting for you* (default on), covers sends,
  posts, shares, invites, payments, access changes and deletes in connected
  apps. Misty's own tools keep their current behavior.
- The SDK provider capability system was removed afterwards; see *Retired
  features* below.

### Phase 3 — Screens on demand (implemented and verified live October 4, 2026)

- Desktop runs get `screen_open` (a browser for the task, optionally at a URL)
  and `screen_look` (the user's screen). Either call ends the response with a
  `screen.request` event. The desktop opens the screen from the account setting
  *Where Misty works on screen* (Separate window, the default / This window /
  Ask each time, shown as a card in the chat), or captures the screen, then
  continues the same conversation with it attached. The continuation shows no
  new user turn.
- Change from the approved wording: the run hands off to a continuation run
  instead of pausing and resuming. The run's mode, task and window are frozen
  at admission and checked in about a dozen places, including the device lease
  and job authority. A continuation goes through those same tested checks; a
  mid-run attach would have reopened all of them. The user sees one
  conversation either way.
- Deleted: the work-location dropdown, the stored per-agent mode, the voice
  model's `needs_screen`/`needs_browser` flags, `companionBrowserIntent.ts` and
  the screen-context regex. Typed and voice turns always start in the
  conversation; `screen_look` continuations through the companion still capture
  every display, so answers can point at the screen.

### Phase 4 — Midscene on the desktop (implemented and verified live October 4, 2026)

- `browser_act(goal)` is one device job per goal. The desktop runs Midscene's
  planner locally in a bounded loop (24 actions, 4 minutes): capture the page,
  plan one action, act through Misty's native input under a grant scoped to the
  job, repeat. Leases, Stop and takeover apply to every action. It returns what
  happened, where the cursor stopped and the final screenshot.
- Model calls go to `POST /me/screen-model/{jobID}`, a thin pass-through that
  accepts calls only while that act job runs, uses the run's model through the
  AI Gateway, caps output, and meters
  each call to the run without spending its agent turns. Inference stays at the
  provider; neither the server nor the Mac runs a model.
- The agent cursor is Misty's in-page pointer, separate from the user's.
  Native input glides it to each target before acting and leaves it in place,
  so every screenshot shows where the agent points, and each result reports
  its position. The user's own pointer never moves.
- Actions stop before sending, publishing, buying, deleting or changing access
  unless the call sets `allowConsequential`, which the model sets only when the
  user asked for exactly that.
- Desktop browser grants no longer include `browser.click`, `browser.type` or
  `browser.interact`, so Misty-window tasks act only through `browser_act`.
  The runtime's server-side planner (`misty_browser_act`), its Midscene
  dependency and the pinned SDK execution path were removed once no run could
  grant native input directly.
- Screen calls use the run's frozen *vision* route, which defaults to the run's
  model. When the account points that route at its own provider connection,
  calls go there with the account's key; billing meters the same route.
- Midscene's Node-only helpers get browser stubs in the desktop build
  (`src/shared/platform/nodeShims`); reports and caches are not written.
- Scope at first: Misty's own windows. Other Mac apps came next (below).
- The companion stays the teacher: `screen_look` through it captures every
  display, so answers can point at things on screen while the user clicks.

### Other Mac apps with Misty's own cursor (implemented October 4, 2026)

- `screen_open` takes `target: desktop` for work in another app (Numbers,
  Finder, Mail). The run hands off, desktop control starts after the user
  allows it (when *Ask* is on), and the conversation continues with the
  desktop attached. Desktop and Misty-window screens grant
  `browser.workspace.visual` and `browser_act`, so the model works in goals
  there too; the act job grants itself the workspace input it needs.
- The same local loop runs on these surfaces. Midscene plans single clicks,
  typing, named keys and scrolling; dragging is not available, and the
  planner is told so.
- Misty's cursor on the desktop is a click-through overlay drawn with the
  same arrow as the in-page and Misty-window cursors, kept visible in every
  capture. Clicks press the control under it or focus the field through
  Accessibility; text is inserted into that field; keys and scrolling go only
  to the target app. The person's pointer never moves and their input is never
  blocked; Escape and Stop still end the task. Misty refuses to operate its own
  control strip.
- Accessibility cannot press everything (canvas apps, custom controls). Those
  steps report that nothing usable is at the point, and a goal that makes no
  visible progress stops after three tries.
- `npm run check:desktop-agent` is the live check: it opens a scratch text file
  in TextEdit, clicks into it, types and selects through the agent pointer,
  and confirms the person's pointer did not move. It needs Accessibility for
  the terminal that runs it.

### Retired features (removed October 4, 2026)

These no longer exist in the app, server, runtime or database. Their tables
were dropped by `20271004070000_retire_legacy_features.sql`.

- The SDK provider capability system and installed-app execution authority.
- MCP connectors (user-added MCP servers). Misty's own MCP server between the
  gateway and the runtime remains; it is only transport.
- Studio workflows, workflow versions, proposals and the tool-approval waits
  (`approval.resume`). Connected-app confirmations are the *Ask before acting
  for you* cards from Phase 2.
- Native GitHub, Figma, Slack, Discord and Instagram integrations, social
  messaging, provider-shared resources and the provider OAuth shell. Apps go
  through Composio; Google, Microsoft and Dropbox account connections remain
  for calendars and files.
- Direct instance model providers (`OPENAI_API_KEY`,
  `MISTY_AGENT_MODEL_PROVIDER`). Instance AI bills the AI Gateway; accounts
  can still bring their own keys in Settings.
- The single-turn voice relay and the WebRTC voice transport. Voice is always a
  realtime conversation over the gateway WebSocket.

### Every model call uses the AI SDK (October 5, 2026)

The Go API no longer calls models over HTTP. Library analysis, embeddings,
media and voice transcription, the screen planner and Go's own completions go
to the agent runtime's signed `POST /v1/models/{text,embed,transcribe}` routes
(`server/internal/modelruntime`), which call the model with the Vercel AI SDK
(`generateText` with structured output, `embedMany`, `transcribe`). Go still
resolves each call's route (Misty's Gateway, or the account's own connection
and key, sent only over the signed channel) and meters it before and after.
The runtime client never follows redirects, so a key cannot be resent
elsewhere. Two things stay in Go: the realtime voice socket (the AI SDK has
no server realtime voice API) and the public Gateway model list, which the
SDK's model listing returns without the capability tags the model picker
filters on.

### Context management and compaction (October 5, 2026)

Misty follows the pattern agent harnesses converged on (Claude Code, Codex,
OpenCode, and the Anthropic and OpenAI compaction APIs), implemented once in
the runtime so it works for every provider behind the Gateway.

- **Measured in tokens against the model's window.** Go sends each run the
  model's `context_window_tokens` from the Gateway catalog (128,000 when
  unknown). The runtime estimates the next call as the model's last reported
  input tokens plus what the transcript grew by.
- **Inside a run** (`src/context-compaction.ts`): past 60% of the window, tool
  results older than the last four are replaced with a placeholder (calls stay
  paired; errors are kept, shortened). Past 80%, the older steps are rendered
  as text and summarized into structured notes (task, done so far with every
  change named, key facts quoted, problems, current state, next) by the run's
  own model. The task, the person's messages and the latest steps stay
  verbatim. Summary calls are `model:compact:N` nodes: metered, but they do not
  spend a model turn. The person sees "Summarizing earlier steps…".
- **Across turns** (`ai_conversation_compaction.go`): a Misty chat sends recent
  turns verbatim within a fifth of the window (12,000–96,000 characters) and
  everything older as running notes in `ai_conversation_summaries`, extended
  rather than rebuilt as turns age out. After summarizing, the verbatim part is
  trimmed to half its budget so the next summary is several turns away. Notes
  use the account's own agent connection when it has one, are metered, and get
  20 seconds before the turn proceeds without them and a background call
  finishes them. The transcript shows "Earlier messages summarized" where the
  notes end. Companion voice keeps its short last-turns history.
- Notes and summaries are untrusted data, labeled as such, never system text.

### Agents for other members (approved October 4, 2026)

A member's agent can ask another member's agent for work when both members
share a Space. This adds to the principles above; it does not relax them.

- **Consent.** The owner publishes an agent to a Space
  (`space_agent_listings`) with a description, how it takes requests (ask me
  first, the default; start right away; or off) and a limit of 1–10 open
  requests. Unpublished agents cannot be reached.
- **Tools.** `agents.directory` lists published agents in shared Spaces.
  `agents.request` sends a self-contained message and waits up to 40 seconds;
  `agents.request_status` keeps waiting. Replies are data, never instructions.
- **Authority.** The work is a `delegated` run owned by the target agent's
  owner, with that owner's permissions in the shared Space only: no other
  Spaces, memory, agent settings, connected apps, screens or further
  requests. Every tool call re-checks the listing and both memberships, so
  unpublishing the agent or leaving the Space stops it.
- **Who pays.** The requester pays for their own agent's turns, including
  asking and waiting. The target owner pays for their agent's work, using
  their own model settings.
- **Approval follows the listing.** A listing that asks first waits for its
  owner to approve each request; nothing runs or is charged until then, and an
  unanswered request expires after 24 hours. A listing set to start right away
  queues the work at once. (Agents have no user-visible run mode, so the
  owner's choice lives on the listing they control.)
- **Bounds.** 12 model turns and 10 minutes per request, 5 requests per run,
  60 per member per hour, delegation depth 2, and no requests from inside
  requested work. A repeated call returns the original request. Stopping the
  requester's run stops the work it asked for.
- **Visibility.** Requests, approvals and listing changes are Space events,
  and the finished reply is posted in the Space by the agent that did it.

States follow A2A: submitted, awaiting approval (A2A's auth-required),
working, completed, failed, rejected and canceled.

- **A2A endpoint.** `POST /a2a/spaces/{space}/agents/{agent}` speaks A2A's
  JSON-RPC: `message/send`, `message/stream`, `tasks/get`, `tasks/cancel`,
  `tasks/resubscribe` and `tasks/pushNotificationConfig/{set,get,list,delete}`.
  `GET …/.well-known/agent-card.json` describes the agent. It sends every
  message through the same request service, so consent, approval, billing and
  limits match `agents_request`. A repeated `messageId` returns the same task.
  Requests from it count toward the hourly limit, not the per-run limit.
- **Only members' own agents (approved October 5, 2026).** Agents talk to
  other members' agents from inside Misty; there are no outside A2A clients.
  Every call carries the member's session cookie *and* a `Misty-Agent-Token`
  header. The app mints the token from the session
  (`POST /a2a/agents/{agent}/token`) for an enabled agent the member owns.
  It lasts five minutes, is bound to the session that minted it (by hash), and
  is signed with a key derived (HKDF) from the account signing key under its
  own label, so session and agent tokens never verify as each other and rotate
  together. Each call re-checks that the agent still exists, is enabled and
  belongs to the member; long streams re-check the session and agent every
  minute. Neither credential works alone, and the custom header stops
  cross-site use of the cookie. Tasks and push configs are scoped to the agent
  that sent them, not just the member.
- **Streaming.** `message/stream` and `tasks/resubscribe` answer with
  server-sent events: the Task, a `status-update` per state change, the reply
  as an `artifact-update`, and a final `status-update`. Account events wake
  the stream (a delegated run changing state now notifies the requester), with
  a 5-second poll as fallback. A stream lasts at most 15 minutes; clients
  resubscribe to keep waiting, for example on approval.
- **Push notifications stay inside Misty.** A push config's `url` must be the
  member's Misty inbox (`/a2a/push`); Misty never posts to other addresses, so
  there is no webhook for SSRF or data to leave the app, and push
  `authentication` is refused. The agent reads `GET /a2a/push` as a
  server-sent event stream with the same two credentials; each event carries
  the config id, its `token` and the Task. A state change is recorded before it
  is written and released if the write fails, so it reaches one open inbox, or
  the next to connect. At most 5 configs per task; finished configs are pruned
  after a week.

### Catalog coverage (October 5, 2026)

Every route that changes data has a recorded decision in
`server/test/contract/http/app/agent_tool_coverage_test.go`: the tool that
reaches it, why agents never use it (credentials, payments, vault keys,
access control, a person's own decisions), or a named gap. A new route fails
that test until someone decides; it records no open gaps. Common actions
keep their own tools; rarely used administration shares one tool per area with
an `action` field (`spaces.manage`, `library.organize`, `roadmaps.plan`,
`roadmaps.canvas`, `items.delete`, `items.rename`).
Deleting, inviting, removing a member and leaving a Space follow *Ask before
acting for you* with the same approval card connected apps use.

### Device tools: folders, tabs and bookmarks (approved October 5, 2026)

Desktop chats carry two kinds of device grants beside browser tabs, and the
server offers matching tools only for grants it receives:

- **Shared folders.** The person picks a folder in the system picker from the
  agent's access panel (*Shared folders*); a page or model can never name a
  path. Agents get `files.list` and `files.read` (text from documents, PDFs and
  spreadsheets, 20,000 characters at most) inside that folder only, never
  change or delete anything, and hidden files are skipped. *Stop sharing*
  removes the grant on that computer.
- **The Misty browser.** `tabs.list` shows open tabs (never private tabs),
  `tabs.open` opens a website, `bookmarks.list` searches bookmarks and
  `bookmarks.add` saves one.

Each call runs as a device job on the person's own computer, which re-checks
the grant and stays inside it. Work another member's agent asked for never has
device grants.

## Acceptance prompts

Taken from real failed runs in October 2026. Each must complete or ask one
useful question, never "I can't" because of a Misty-side gate.

| Prompt | Expected path | Phase |
| --- | --- | --- |
| "find my two latest notes across spaces" | `notes_search` without a space | 1 |
| "update the note I just read" | `notes_update` with no grounding error | 1 |
| "tell the team the launch moved to Friday" | `messages_send` without word-overlap checks | 1 |
| "just tell me what emails I missed" | Composio Gmail, with a connect card if needed | 2 |
| The Google Drive request above | Notes + Composio Drive | 2 |
| "Research GothamChess's latest uploads" | Composio search, or a screen task | 2–3 |
| "Open example.com and tell me the heading" | Screen task in the default chat | 3 |
| "Draw a house in Excalidraw" | Midscene with a visible cursor | 4 |
| "Ask Bob's Researcher agent in the Launch team Space what the launch date is" | `agents_request`, Bob approves, the reply reaches Alice's agent | Members |

### Running them

`npm run acceptance` runs every prompt live against the local development
server (`misty server up`), with its runtime, model provider and Composio
project. Each run registers a fresh test account with known notes, Spaces and a
team chat; evidence for each case (tools, events, final text, screenshots) is
written to the git-ignored `.misty/acceptance/`.

- `src/tests/acceptance/agentPrompts.acceptance.ts`: Phases 1–3 through the
  real API and event stream. Screen requests are checked at the
  `screen.request` handoff.
- `src/tests/acceptance/agentDelegation.acceptance.ts`: agents for other
  members. Two fresh accounts share a Space; Bob publishes an agent that asks
  first, approves Alice's agent's request, and Alice's agent reads the reply.
- `src/features/agents/screenAct/screenAct.acceptance.ts`: Phase 4. The shipped
  `runScreenAct` loop and Midscene planner drive a headless Chromium that
  answers the desktop's browser operations and draws the same agent cursor.
  Model calls take the exact shape the server pass-through forwards. It covers
  a form, a stop before a consequential send, and the Excalidraw house.

The first live run on October 4, 2026 found and fixed:

- Screen-model calls were rejected: node IDs must start with `model:`, and
  current reasoning models reject `max_tokens` and `temperature: 0`. The
  pass-through now sends `max_completion_tokens` (6,000) and meters calls as
  `model:screen:<job>:<n>`, which do not spend the run's agent turns.
- The screen loop ended on one malformed planner reply or an empty reasoning
  reply; it now feeds the error back up to twice. It also stops after three
  actions that leave the screenshot unchanged instead of repeating them.
- Saving the user's own edits counted as consequential. Only sending or
  posting to other people, publishing, buying, deleting and access changes do.
- `notes_read` omitted an empty body, so the model could not tell an empty
  Note from a missing one; `notes_update` rewrote the whole body to add a line.
  Reads now always include `markdown` and `empty`, and updates take `append`.
- A Connect or approval card that outlived its 40-second hold ended the run as
  failed. It now hands off like a screen request: the run ends with the card,
  and the conversation continues once the app is connected or the action is
  approved.
