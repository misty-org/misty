# Agentic browser — implementation plan

Makes Misty's agent fast and reliable at long, multi-site work: research projects,
assignments, forms, spreadsheets and documents. Written October 10, 2026 against `main` at
`3fbe6f820`. Decisions recorded October 10, 2026 (see the end).

Everything the agent sees and does on screen happens on the user's own machine: in a tab of
the workspace they are in, or in a separate agent window that is its own workspace. There are
no cloud browsers. The reasoning loop stays on Misty's server runtime, which calls the model
providers, as the devices brief already describes.

## Status (October 10, 2026)

Phases 0–6 are implemented, uncommitted. Phase 6 follows the approved
[agents-on-devices brief](../design/agents-on-devices/BRIEF.md). Results are in
[agentic-browser-results.md](agentic-browser-results.md): on the 16 fixture tasks, three runs each,
success rose from 79% to 96% and p90 time fell from 24.4 s to 16.1 s.

Where the build differs from the text below:

- **Page layer.** The runtime is new code in `src-tauri/src/infra/browser_page/` (core, tree, actions,
  read, skills), written to Playwright's aria-snapshot design rather than ported; no third-party code
  was copied, so no notices were needed. The older `browser_inspection_*.js` scripts stay for
  `browser.inspect` and its other callers. Snapshot refs also work with `browser.upload`.
- **Isolated world.** On macOS the runtime runs in its own WKContentWorld (`misty-agent-page`), the
  first item listed under Kiri below; it was a two-line generalization of the existing page-state
  world, so it lives beside it in `browser_content_world.rs` rather than in Kiri.
- **Native input** is used whenever the tab is visible; hidden tabs (the agent's own and sub-agents'
  tabs) fall back to script events, and each step reports which it used.
- **Skills live with the page runtime** (`page_skills.js`), because their helpers must run in the
  page; a snapshot lists only the skills its page offers. The Google skills were rebuilt after live
  runs in Misty's browser (October 10): Docs ignores scripted pastes, so `google-docs.write` types
  through Docs' hidden input with its own shortcuts for headings, lists and bold; both apps are read
  through Google's export of the saved file (`google-docs.read`, `google-sheets.read`), and the
  Sheets skill pastes and jumps on its own (`google-sheets.paste`, `.goto`).
- **Google Sheets in Misty.** Sheets never started in Misty's browser: wry defined `window.ipc` as a
  read-only global, and Sheets' script declares its own `ipc`, so it failed on its first line. The
  vendored wry now defines it so pages can redeclare it (`vendor/wry/MISTY-PATCH.md`).
- **Phase 2, measured first.** The benchmark shows tools take 7–10% of a run and the model the rest,
  so most of the work went to fewer and shorter turns (skills, snapshot pruning, cache breakpoints)
  and to MCP session reuse and concurrent server reads. The output cap is a flat 8,192 tokens per
  call rather than raised per turn: billing holds it and settles what the call used.
- **Fewer checkpoints.** A read-only call sends one runtime checkpoint, on finish. Misty announces
  its start when the MCP call arrives (`agent_runtime_tool_start.go`), with the same receipts, so the
  conversation and the run's steps look as before. `browser.steps` is one call, so one pair.
- **Device hop.** After browser work the desktop holds its next claim open for up to 25 s
  (`workerHeldClaim.ts`, `device_job_claim_wait.go`): the run's next job is handed over the moment
  it is queued, skipping the notification and the separate claim request. One held claim per
  device; a claim answered as the device hangs up goes straight back to the queue; notifications
  stay the fallback, and a server without held claims is detected and skipped. It is a held claim
  rather than a separate channel, so leases, checks and Stop are unchanged. Its gain has not been
  measured on a full-stack desktop run yet (`npm run trace`).
- **Turn limit.** Agent-mode runs (every run with a screen) already get 120 turns bounded by their
  time budget and usage limits; ordinary chat keeps its plan's limit, which is a pricing choice.
- **Replays** run for workflow runs that have a browser attached, which today means runs started from
  the desktop: scheduled runs get no device yet (`workflow_schedules.go`).
- **Sub-agents** run as ordinary invocations under the parent's lease; `agents_delegate` waits up to
  4.5 minutes, like a device job, and `agents_wait` picks up longer ones, rather than a new durable
  wait type. They replace the older `ask.delegate` background worker where offered. Sub-agents get
  their own hidden tabs in the parent's task; the per-device cap is the four-task limit per call.
- **Notebook note.** The notebook shows in the conversation and is mirrored to a note in the
  account's personal Space (its first Space). An account with no Space keeps it in the
  conversation only; Misty does not create a Space for it.
- **Phase 6, agents on devices.** The composer's device row picks where the agent works: this
  computer or one online device. `screen_open` then asks that device to open a browser session
  (`browser.session` job, `remote_sessions.go`); the device opens it under its own native lease,
  signs its own tab's grant and shows "working here" with Stop (`hostedSessions.ts`), and the
  asking device continues the conversation with that tab (`screenRequests.ts`). The server proves a
  tab came from a session by the session job's stored output before letting a user-mode chat act
  in it. An offline, silent or busy device ends the step with "pick another device"
  (`device_offline`). Computers stay awake while agents work on them (`power_keep_awake.rs`,
  `keepAwake.ts`; account setting under Settings › Agents › Screens, on by default).
- **Claim rules fixed.** The window and user-mode checks at claim time applied to every device
  job; they now apply to browser tabs and to acting in a page, so shared folders and another
  device's tabs work from agent chats.
- **Sub-agent tabs fixed.** Tabs a device opened for sub-agents were validated as if they came
  from a page and were always refused; they now get their own check (`validateDeviceOpenedTabs`).
- **Benchmark in Misty's own browser.** The benchmark runs each task in a Misty tab, in the system
  webview (WKWebView, WebView2), through the desktop's agent path, by a bridge that exists only in
  debug builds (`browser_eval_bridge.rs`). It no longer uses Chromium; results before October 10
  were measured on a Chromium stand-in that loaded the same page code.
- **Browsing model.** A fifth sense, Browsing, defaults to the Seeing model; extraction and
  sub-agents use it.

The approach is to adopt architecture that already works in shipping agents (Playwright MCP,
browser-use, Stagehand, Nanobrowser, Claude in Chrome, Polar's published design) and keep
Misty's own layer on top: the capability gateway, policy and approvals, the action journal,
billing, device leases and Stop, Spaces data tools and the conversation UI.

## Why runs are slow and fragile today

| Concern | Today | Problem |
|---|---|---|
| Seeing a page | The main agent can read a page (`browser.inspect`, `browser.visual`) but the agent's own browser grant is `inspect`, `visual`, `navigate`, `act` ([agentOwnedBrowserWorkspace.ts:44](../../src/features/agents/agentOwnedBrowserWorkspace.ts#L44)) | It cannot use the element references it just read. Every click goes through `browser_act` |
| Acting on a page | `browser_act` runs Midscene's `Agent.aiAct` in screenshot-only mode (`interfaceType = "static"`, [screenDevice.ts](../../src/features/agents/screenAct/screenDevice.ts)), up to 70 plans and 4 minutes ([screenActJob.ts:29](../../src/features/agents/screenAct/screenActJob.ts#L29)) | Each click or keystroke is a full screenshot plus a vision-model call through `/me/screen-model`. Text-heavy pages and forms pay for vision they don't need |
| References | A click or interaction marks the whole inspection consumed ([browser_inspection_click.js:15](../../src-tauri/src/infra/browser_inspection_click.js#L15)) | Even where by-reference actions exist, every action needs a fresh inspection and a fresh model turn |
| Synthetic clicks | `browser_inspection_click.js` dispatches script events | Sites that check `isTrusted` ignore them; native input exists only on the coordinate path |
| Hard sites | No app-specific tools; Composio APIs are available but nothing steers toward them | Canvas grids (Google Sheets, Excel), rich editors (Docs, Word, Notion) and virtualized tables (Airtable, CRMs) become one vision click per cell or line |
| Per-call overhead | Each tool call exchanges a new MCP token and opens a new MCP connection ([tool-calls.ts:41](../../server/apps/agent-runtime/src/tool-calls.ts#L41), [mcp-runtime.ts:47](../../server/apps/agent-runtime/src/mcp-runtime.ts#L47)), checkpoints before and after, and browser calls queue a Postgres device job that the desktop claims ([browser_agent_tools.go](../../server/internal/platform/httpapi/browser_agent_tools.go), [worker.ts](../../src/features/agents/worker.ts)) | For short actions the plumbing likely costs more than the action. Not yet measured |
| Per-turn overhead | Steering, budget and admission requests before every model call ([space-task-agent.ts:199](../../server/apps/agent-runtime/workflows/space-task-agent.ts#L199)) | Same |
| Concurrency | Every tool call in a response runs one after another, reads included ([serial-tool-lifecycle.ts](../../server/apps/agent-runtime/src/serial-tool-lifecycle.ts)) | Independent reads wait on each other |
| Output | 2,200 output tokens per model call ([space-task-agent.ts:125](../../server/apps/agent-runtime/workflows/space-task-agent.ts#L125), `MaxModelOutputTokens` in [types.go:46](../../server/internal/agents/types.go#L46)) | A long table, form answer or document can't be written in one call |
| Delegation | One agent per run, no sub-agents, no shared working notes | Wide research is serial; long runs depend on compaction alone to remember the plan |
| Prompt layout | Not arranged for provider prompt caching | Each turn pays full price and latency for the unchanged history |

Strengths to keep:
- The snapshot, staleness and by-reference scripts already exist (`browser_inspection_snapshot.js`, `_click.js`, `_type.js`, `_interact.js`, `_upload.js` in `src-tauri/src/infra/`). This plan evolves them rather than starting over.
- `documentId` staleness checks that reject an action before dispatch when the page changed.
- Native input with Misty's own cursor, leases, Stop and takeover.
- The approval policy and "Ask before acting" cards (`confirmAgentAction`).
- Durable runs, the journal with idempotency keys, compaction, and billing.
- Midscene for canvas pages, games and other Mac apps.

## What we adopt, and from where

| Piece | Proven in | License | Use |
|---|---|---|---|
| Accessibility snapshot as a compact text tree with refs, refs passed back to act | Playwright MCP, Playwright `ariaSnapshot` injected script | Apache-2.0 | Snapshot v2, actions by ref |
| Fill a whole form in one call; find elements by plain-language description | Claude in Chrome tool design, Playwright MCP `browser_fill_form` | design / Apache-2.0 | `browser.fill_form`, `browser.find` |
| Several actions per step, stop when the page changes; short action outputs; page text first, screenshots on demand; history before page state for caching | browser-use | MIT | Action batches, prompt layout |
| `extract(schema)` with a small model over page text; `observe`; cached replays with self-healing fallback | Stagehand | MIT | `browser.extract`, workflow cache |
| Planner and navigator as separate agents, each on its own model | Nanobrowser | Apache-2.0 | Orchestrator and navigator split |
| Orchestrator with parallel sub-agents writing to shared memory; custom tools for spreadsheets, docs and maps; mixed models | Polar (closed source, published design) | design only | Delegation, run notebook, pattern and app skills |
| Plan and findings files that survive context resets | Manus-style planning files, browser-use file system | design / MIT | Run notebook |
| Parallel agents each in its own tab | BrowserOS | AGPL-3.0, design only | Tab-per-sub-agent |
| Per-site permissions, blocked categories, approval for high-risk actions, untrusted page content | Claude in Chrome | design only | Policy additions |

Code rules: copy code only from MIT or Apache-2.0 projects, keep their notices in a
`THIRD_PARTY_NOTICES` entry next to the ported file, and record the upstream commit. Never copy
from BrowserOS (AGPL-3.0); read it for design only.

Misty's pages run in WKWebView, WebView2 and WebKitGTK, not Chromium, so nothing that needs
the Chrome DevTools Protocol runs in a Misty tab. Everything adopted here is either an in-page
script, a tool schema or an agent-loop pattern. No CDP code is used.

## Phases

Each phase ships on its own, leaves the app working and is judged against the Phase 0 benchmark.

### Phase 0 — Benchmark and tracing

- **Task suite (`server/apps/agent-runtime/evals/browser/`).** About 40 frozen tasks with
  rubrics, run against live sites with test accounts. Each category spreads across several
  apps so no single product is tuned for:
  - research: a cited multi-source report (5 tasks);
  - assignments: read a prompt on a learning platform (Google Classroom, Canvas), write the
    answer in Google Docs, Word online or Notion, and submit it (5);
  - forms: Google Forms, Microsoft Forms, Typeform, a multi-page signup on a sandbox site, a
    file upload (6);
  - spreadsheets and tables: fill a 50-row range, add a formula column, sort and chart, in
    Google Sheets, Excel online and Airtable (6);
  - work apps: create or update records in a CRM, an issue tracker and a project board (6);
  - mail and messages: draft and send with approval in Gmail and Outlook, post in Slack (4);
  - multi-site: read from one app, write to another (5);
  - long horizon: 20+ step tasks with a deliberate distraction or failure midway (3).
- **Judge.** Rubric grading by a model that sees the final screenshots and the run's tool
  trace, the method polar-evals and BU Bench use. Check polar-evals' license before borrowing
  any of its tasks.
- **Tracing.** One span per model turn, tool call, MCP exchange, device-job hop and screen-model
  call, so each run yields a waterfall: model time vs plumbing time vs page time.
- **Baseline.** Run the suite three times on today's build. Record success rate, median and
  p90 time, cost and steps per task.

Done when the baseline report is committed under `docs/plans/agentic-browser-results.md`.

### Phase 1 — Text-first page layer

Evolves the existing inspection scripts into the Playwright MCP model.

- **Snapshot v2** (`browser.snapshot`, replacing `browser.inspect` for agent runs):
  - accessibility-tree text: role, accessible name, state (checked, expanded, disabled,
    value), nesting, with a short `ref` on every actionable or scrollable node;
  - port Playwright's role and accessible-name computation instead of the current label
    heuristic;
  - same-origin frames inline (as today); cross-origin frames listed by origin and
    snapshotted on request;
  - size budget with "more below" markers instead of hard truncation; an optional `scope`
    ref to snapshot one region.
- **Refs that survive actions.** Replace "inspection consumed" with per-element checks: a
  ref stays valid while its element is connected and its fingerprint matches. A navigation
  or document swap invalidates all refs. Staleness is still detected before dispatch and
  still returns `browser_snapshot_stale` with `attempted: false`.
- **Actions by ref**, each returning a small diff of what changed (URL, focused element, new
  dialogs, changed text near the target) instead of a full page:
  - `browser.click` (`ref`, `button`, `clickCount`), `browser.fill` (`ref`, `text`,
    `submit`), `browser.select` (`ref`, `values`), `browser.key` (`key`, `modifiers`),
    `browser.scroll` (`ref` or page, `direction`), `browser.hover`, `browser.wait_for`
    (`text` appears or disappears, navigation, or time; no model calls);
  - `browser.fill_form` (`fields: [{ref, value}]`): one call fills a whole form;
  - `browser.steps` (`steps: [...]`): up to 10 actions in one call. It stops at the first
    action that navigates, opens a dialog or invalidates a later ref, and reports which
    steps ran.
- **Trusted input.** Click, key and type go through Misty's native input path at the ref's
  on-screen bounds (the path `browser.interact` `native` already uses), with the agent
  cursor gliding there. Script events remain only as a fallback the result reports.
- **`browser.extract(instruction, schema)`.** Page text, converted to Markdown, goes to a
  small model that returns JSON matching the schema. The main agent never loads the whole
  page. Metered like other one-shot model calls.
- **`browser.find(description)`.** Returns the best matching refs from the latest snapshot,
  for large pages.
- **Screens stay.** `browser.visual` remains on request. `browser_act` with Midscene remains
  for canvas pages, games, maps and other Mac apps. The tool descriptions say when to use
  which.
- **Policy.** Each by-ref action is classified before dispatch from the element and its
  form: a submit or button whose name or form purpose is send, post, pay, buy, delete,
  share or invite is consequential and goes through the same approval card as
  `allowConsequential`. Password and payment fields are never filled by the agent; it uses
  `browser.request_user_action` instead.
- **Grants.** The agent's own browser grant adds the new capabilities. Workspace and
  desktop surfaces are unchanged.

Ours: the gateway descriptors in
[agent_toolbox_catalog.go](../../server/internal/platform/httpapi/agent_toolbox_catalog.go),
grant checks in `src-tauri/src/infra/browser.rs`, consequential classification, journal entries.

Tests: script unit tests on fixture pages (forms, menus, shadow DOM, same-origin and
cross-origin frames, virtualized lists); Rust tests for grant checks and staleness; a live
acceptance check that fills a sandbox form through `browser.fill_form` and submits it after
approval.

Done when the forms, research and multi-site tasks beat the baseline on success and median
time, and no action fires on a stale ref.

### Phase 2 — Less overhead per action and per turn

Measure with Phase 0 tracing first; do only the items the waterfall shows matter.

- **One MCP session per run.** Keep the MCP client connected across calls in a run and
  refresh its bearer before expiry, instead of a token exchange and a new connection per call.
- **Fewer checkpoints.** One checkpoint per read-only call (on finish); batched checkpoints
  for `browser.steps`.
- **Faster device hop.** While a run holds a browser lease, keep a run-scoped job channel open
  on the desktop so later calls skip the claim round trip. Fall back to the job queue when the
  channel drops.
- **Parallel reads.** Calls the catalog marks read-only run concurrently; writes stay serial
  and keep today's stop and pause rules.
- **Cacheable prompts.** Order each request as system prompt, tool catalog, history, then the
  newest page state, and set provider cache breakpoints. Snapshots older than the last two are
  replaced by a one-line summary.
- **Output budget.** Raise the per-call cap when the turn's tools include writes that carry
  content (documents, sheets, form answers), metered as today.
- **Navigator model.** Browser steps inside a sub-goal use a fast model. Planning and final
  answers use the run's model. By default the navigator reuses an existing model sense.
  Settings › Agents › Models gains an optional Browsing choice that overrides it, following
  the settings row rules (Reset only while changed, helper text, checkmarked dropdown).
- **Turn limit.** Replace the fixed turn count with the time and cost budget the run already
  has, so long tasks aren't cut short by step count alone.

Done when the median per-action time on the benchmark (model time excluded) drops by at
least half against Phase 1.

### Phase 3 — App skills, APIs first, cached workflows

The goal is broad coverage, not a few hand-tuned products. Three layers, tried in order:

- **APIs first, for any connected app.** When the account has an app connected through
  Composio, the agent uses its API for reads and bulk writes. That covers every Composio
  toolkit (Google Workspace, Microsoft 365, Notion, Airtable, Slack, HubSpot, Salesforce,
  Jira, Linear, GitHub and the rest) without per-app work in Misty. The catalog-generated
  prompt says so; the screen is for what the API can't do or what isn't connected.
- **Pattern skills, shared across apps.** Most hard web UIs are a handful of widget types.
  Each skill detects its pattern on the page, whatever the site, and gives the agent tools
  for that pattern:
  - grids: canvas or virtualized spreadsheets and tables (Google Sheets, Excel online,
    Airtable, Smartsheet, CRM list views). Jump to a cell or range, paste tab-separated
    values through the clipboard, read the visible range, fill a formula or column;
  - rich-text editors: contenteditable, ProseMirror, Lexical, Quill and canvas editors
    (Google Docs, Word online, Notion, Confluence, mail composers). Insert at a position,
    replace a section, apply headings and lists, paste formatted Markdown;
  - forms and surveys: answer by question label across Google Forms, Microsoft Forms,
    Typeform and plain HTML forms, including choice grids, dates and file questions;
  - boards and record views: cards, columns and record fields (Trello, Jira, Linear, Asana,
    CRM records). Find a record, edit a field, move a card;
  - date pickers, comboboxes, autocompletes and nested menus;
  - file pickers and uploads.
- **App skills, only where a pattern isn't enough.** A small instruction set plus helpers for
  one app's quirks, such as keyboard shortcuts, a URL scheme for jumping to a record or a
  known sign-in redirect. They are loaded when the active tab's domain matches. Which apps
  get one is decided by benchmark failures and usage data, not up front.
- **Skill format.** Skills live in the repo (`server/apps/agent-runtime/skills/`), each with
  a manifest (patterns or domains, tools, version), instructions and page helpers that run
  through the Phase 1 script channel. They are reviewed like code and covered by fixture
  pages, and they are listed in the catalog only when their pattern or domain is present.
  Adding an app should take a manifest and a few helpers, not runtime changes.
- **Cached workflows** (Stagehand's pattern). A successful run of a saved workflow records
  each step's ref resolution as a stable locator (role, name, nearby text). Scheduled re-runs
  replay those steps without model calls, check each result, and fall back to the agent on
  the first mismatch, then refresh the cache. Consequential steps still ask for approval
  unless the workflow's rule allows them.

Done when the spreadsheet, editor and work-app tasks pass at the rate the forms tasks reach
across every app in the suite, not only one per category, and a cached workflow re-run uses
no model calls when the site hasn't changed.

### Phase 4 — Orchestrator, sub-agents and run notebook

- **Run notebook.** Each run gets a notebook: `plan.md` (steps and status), `findings.md`
  (facts with source URLs) and files the run produces. The agent reads and writes it with
  notebook tools. It survives compaction, so the plan is re-read after each summary. It is
  visible by default: the conversation shows the live plan and findings as the run works, and
  the user can open the full notebook. Storage reuses notes and the Library.
- **Delegation.** `agents.delegate({ tasks: [{ goal, context, output_schema }] })` starts child
  runs. Each child:
  - gets its own tab in the agent window (the agent's own workspace), or in the user's
    current workspace when the run works there, with its own lease;
  - receives a slice of the parent's time and cost budget;
  - writes to the parent's notebook and returns structured output;
  - shows in the conversation as a collapsible line with live status and Stop.
  The parent waits on durable hooks, then merges. Every child runs on the same machine, so
  the concurrency cap is per device (default 4), sent by the server and lowered when the
  device reports memory pressure.
- **Planner and navigator split** (Nanobrowser). The parent plans and verifies; children
  navigate with the navigator model.
- **Policy.** Children inherit the parent's grants and approval setting, never more.
  Approval cards from children appear in the parent conversation.

Done when the research tasks finish in less than half the Phase 3 time at equal or better
rubric scores.

### Phase 5 — Safety, throughout

- Page text, snapshots, extracted data and child outputs stay marked as untrusted content in
  the prompt. They can never grant authority.
- Site permissions: the account can block domains for agents. Financial, adult and crypto
  categories are blocked by default for by-ref writes, as Claude in Chrome does.
- Benchmark tasks include injected instructions (hidden text, misleading labels, fake system
  messages). A Phase 0 baseline and a target rate are recorded for each phase.
- No passwords, payment details or one-time codes are ever typed by the agent.

### Phase 6 — Agents on devices

Approved October 10, 2026, as [docs/design/agents-on-devices/BRIEF.md](../design/agents-on-devices/BRIEF.md):
no home devices; each request picks the device the agent works on, online devices only, and a
device that drops out ends the step with "pick another device"; computers stay awake while agents
work on them (account setting, on by default). The text below was the earlier direction.

- **Today.** A run on the server runtime can act on another of the account's devices when it
  carries a run grant signed by an admitted device, which the target checks against its own
  policy ([devices brief](../design/devices/BRIEF.md), *Cross-device agent work*). Agents
  have no device identity, and agents cannot message each other; the existing agent message
  routing sends to Space members.
- **Direction.**
  - An agent can have a home device where it works, such as "the Mac mini agent", and runs in
    that device's agent window.
  - An agent can delegate to, or message, the agent on another device. This reuses Phase 4's
    delegation: a child run whose home is device B, authorized by a run grant, with results
    returned to the parent's notebook.
  - Messages from another agent are untrusted content and never grant authority, as today.
  - Files still move device to device over the LAN, never through the server.

## Expected impact

These are expectations to verify with Phase 0, not measurements.

- **Forms, text-heavy sites, research.** Largest gain. Most actions move from a vision loop
  of several seconds per click to a by-ref action in one model turn, with several actions per
  turn. Expect large improvements in time per task and fewer misclicks.
- **Spreadsheets, documents and work apps.** Largest gain in success rate, from connected-app
  APIs and the pattern skills in Phase 3, across Google, Microsoft and other tools alike.
  Phase 1 alone helps little on canvas grids and canvas editors.
- **Wide research.** Phase 4 parallelism cuts wall time roughly by the number of children,
  minus merge time, up to the per-device cap.
- **Little change.** Canvas apps, games, maps and other Mac apps still use Midscene. Sign-ins,
  CAPTCHAs and verification still need the person. Reasoning quality still depends on the
  model.

## Where the code lives

| Layer | Location |
|---|---|
| Page runtime, skills, step runner, site blocks | `src-tauri/src/infra/browser_page/` |
| Grant checks, native input, device execution | `src-tauri/src/infra/browser.rs` and its modules |
| Tool descriptors, policy, approvals, journal, notebook, sub-agents, replays | `server/internal/platform/httpapi/` (`browser_page_tools.go`, `agent_notebook_tools.go`, `agent_delegation_tools.go`, `browser_workflow_replay.go`) |
| Agent loop, MCP sessions, concurrent reads, prompt cache, replays | `server/apps/agent-runtime/` |
| Benchmark, eval device, trace | `server/apps/agent-runtime/evals/browser/` |
| Child tabs, notebook and sub-agent UI, site settings | `src/features/agents/`, `src/features/settings/sections/AgentSitesSection.tsx` |

Kiri stays the web platform layer for pages. Agent tools are not part of it. Kiri gains a piece
only if an engine-level primitive is missing, with the same per-engine rules as its other
layers:
- running the snapshot script in an isolated content world;
- reaching cross-origin frames;
- engine-native trusted input on WebView2 and WebKitGTK.

## Decisions (October 10, 2026)

1. **By-ref actions are re-allowed** for the agent's own browser. This reverses the October 4
   choice in [the agent architecture brief](../design/agent-architecture/BRIEF.md) that routed
   every Misty-window action through `browser_act`; update the brief when Phase 1 lands.
2. **No cloud browsers.** All browsing is local, in a tab or in the separate agent window.
3. **The notebook is visible** in the conversation by default.
4. **Navigator model:** reuses an existing model sense by default, with an optional override in
   Settings › Agents › Models.
5. **Agents on devices** (home devices, agent-to-agent messages) wait until the agent work
   above meets its targets (Phase 6).
