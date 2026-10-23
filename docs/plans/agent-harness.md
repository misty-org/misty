# Agent harness

How Misty's agent works today: the loop, what the model sees, how it reads and acts on pages,
and how a run is checked before it ends. The model decides; the harness decides what the model
sees (tools, their descriptions, the prompt, the context) and carries out what it picks.

Misty keeps its own harness rather than adopting one. Agents must run on any model, and the
popular open harnesses are built and tuned for coding. Misty learns their patterns (Skyvern,
Browser Use, Webwright, OpenCode, Pi, Stagehand, Playwright MCP, Clicky) and keeps the browser,
desktop, cursor and personal-data work its own. Copy code only from MIT or Apache-2.0 projects,
with a `THIRD_PARTY_NOTICES` entry and the upstream commit; AGPL projects (BrowserOS, Skyvern)
are design only.

Related: [agent architecture brief](../design/agent-architecture/BRIEF.md),
[agent browser actions](agent-browser-actions.md), [Odysseys campaign](odysseys-campaign.md).

## Where things run

The server does the minimum. Everything that touches pages, screens, files or code runs on the
person's device; work that must happen while their devices are offline runs in an isolated
Cloudflare Worker, never on the VPS.

| Piece | Runs on |
|---|---|
| Agent loop (durable run, model turns, compaction) | VPS, `server/apps/agent-runtime` (AI SDK on Vercel Workflow, `workflows/space-task-agent.ts`) |
| `agent.gate`: admission and billing, the tool catalog and its rules, the action journal (`log.run`), the device job queue | VPS, the Go API and Postgres (`server/internal/platform/httpapi/`) |
| Model calls, web search | The model gateway; `web.search` calls Serper directly from Go |
| `web.fetch` | The person's device (`src-tauri/src/infra/agents/web_fetch.rs`); the Cloudflare Worker in `server/apps/web-fetch` when no device is online |
| `browser_run` programs, the page layer, screen capture, desktop control | The person's device, inside the Misty app |
| Coding | The person's device, through their own coding tools |

```
request: agent.entry.composer | .cursor | .schedule | .email | .integration.<app>
  └─ Agent loop: small tool surface, prompt stable between compactions
     ├─ browser_run ─ agent.gate (Go: catalog · policy · journal · billing)
     │    └─ Device: the program in a sandbox inside the Misty app (no network, files or globals)
     │         └─ Page API on the agent's own tabs only
     ├─ web_search · web_fetch · agent_delegate (sub-agents for breadth)
     ├─ Misty data tools and connected apps (loaded when the request is about them)
     └─ Completion checks, then one verification turn
```

## Agent vocabulary

The agent's tools, their descriptions and its prompts never use the app's UI labels, so renaming
a section never means refactoring the agent. Names are dotted namespaces, singular, from the
general to the specific. The model sees dots as underscores (`memory.history.search` is
`memory_history_search`), and a family of tools loads by prefix. These names are frozen.

| Agent name | What it is |
|---|---|
| `space.*` | A personal or shared container with members, items and a chat |
| `note.*`, `task.*`, `event.*`, `message.*`, `drawing.*`, `bookmark.*` | Items, named for what they are |
| `file.*` | A stored image, video or document (the Library) |
| `memory.pref.*` | What the person asked the agent to remember |
| `memory.history.*` | What the person did and saw: pages visited, dictations, captures |
| `memory.workflow.*` | A saved request and schedule, plus the steps the agent learned from running it |
| `log.work.*` | One run's checklist and findings, which the person sees |
| `log.run` | The system record of every model turn and tool call (not a model tool) |
| `agent.tool.*` | What a run can do: `answer`, `browse`, `desktop`, `code` |
| `agent.entry.*` | Where a request comes from and how the reply returns: `composer`, `cursor`, `schedule`, `email`, `integration.slack` |
| `agent.gate` | Misty's API side of a run |
| `agent.finish`, `agent.delegate`, `agent.wait` | Ending a run, and sub-agents |

Rules: one glossary maps each agent name to its UI label and is rendered into every prompt
(`agent_entry_glossary.go`); names Misty uses for something else (workspace, vault, window,
pane, project, mode, profile, skill) are avoided; old names are removed, never aliased, and
stored records that name them are migrated in the same change; integrations sit under
`integration.<app>`.

## Tool surface

Every run starts small. `agent.tool` says what a run can do (`src/toolsets.ts`):

- **answer** (the default): read, search, fetch pages, work with the person's own data,
  `screen_open` for the agent's own tab, and `browser_run`.
- **browse**: adds the 17 single-step page tools (snapshot, steps, forms, page skills, the
  screen agent) for what a program cannot do.
- **desktop**: control other apps on the computer. **code**: hand coding in an attached project
  to the person's coding tool.

`agent_tool_use` switches, and `agent_tool_load` adds a family: `integration` (connected apps),
`agent` (sub-agents) or `misty` (notes, drawings, files, chats, Spaces, memory, workflows). A
request about the person's own things starts with `misty` loaded; a request that names a
connected app ("email Sam") starts with `integration` loaded and prefers the app's API to its
website; a run with its own tabs starts with sub-agents loaded. There is no router model.

`agent.entry` sets the reply format and what the screen contributes: the cursor captures every
display on every request, cursor first, and replies in short spoken sentences with pointing tags;
the composer replies in formatted text; schedules, email and Slack reply in their own format with
no screen. Each model family gets a short prompt note (`src/model-family.ts`). Teach mode turns
run the tutor's fast lane (`src/teach-turn.ts`), never the agent loop
([agents-at-cursor brief](../design/agents-at-cursor/BRIEF.md)).

## browser_run

The agent writes a short JavaScript program against a small page API, and Misty runs it on the
person's computer, inside the Misty app, in a QuickJS sandbox with no network, files, app state
or globals (`src/features/agents/programs/`, server side `browser_run.go`). One call can open a
page, fill a form, page through results and collect rows; a list of ten items is a loop instead
of ten turns.

```js
const tab = await open("https://www.oldnavy.com");
await tab.type({ role: "searchbox" }, "women's joggers", { submit: true });
await tab.waitFor({ text: "results" });
return (await tab.read()).tree;
```

- The API: `open(url)`, `tabs()`, `tab.goto`, `tab.read()` (the accessibility tree with refs),
  `tab.text()`, `tab.find(words)`, `tab.click / type / fill / select / check / uncheck / press /
  hover / scroll / scrollTo`, `tab.waitFor`, `keep(tab)` (proof) and `note(row)` (the run's
  results file).
- Targets are a ref from a read, a locator (`{ role, name, index }`) or words describing the
  control; the host keeps each tab's document, so a program never copies document ids.
- A call returns the program's value, its logs, the real error and stack if it threw, and a
  short state of the last tab it touched. Each call has a time limit and an operation cap; a
  long task is many short programs.
- Every consequential click still passes the pay, send, delete and post rules.
- **Agents act only in their own tabs.** `browser_run` and `screen_open` never reach the
  person's tabs, and the "current" screen location opens a tab of the agent's own. A page moves
  to the person only with Move to my tabs.

## Page layer

The single-step tools and `browser_run` share one text-first page layer on the device
(`src-tauri/src/infra/browser_page/`), written to Playwright's aria-snapshot design:

- **Snapshots** are accessibility-tree text with a short ref on every actionable node,
  same-origin frames inline and cross-origin frames reached on request. When a page doesn't fit
  its budget, each menu (navigation, banner, footer, sidebar) gets a small share and says how many
  items it left out; the rest goes to the content.
- **Refs survive actions** while their element is connected and unchanged; a stale ref is refused
  before dispatch with `attempted: false`.
- **Actions** use native input when the tab is visible and script events otherwise, and report
  which they used. Popups that open with a page are closed with their own close control (never a
  sign-up, subscribe or accept control).
- **Page skills** (`page_skills.js`) handle hard widgets: grids, rich-text editors, Google Docs
  and Sheets. A snapshot lists only the skills its page offers.
- **Site blocks** (`site_blocks.rs`): sites agents may read but never act on.
- On macOS the runtime runs in its own content world (`misty-agent-page`). Password and payment
  fields are never filled by the agent; it asks the person with `browser.request_user_action`.

## Reading without a screen

`web.fetch` reads one public page with no cookies or saved sign-ins and returns its title, final
URL and readable text, or the parts that answer the question for long pages, marked as untrusted
page data. It runs on the device (`web_fetch.rs`, `webFetchText.ts`), with the Worker as the
offline path. Both check that every address, including each redirect, is public. Pages that
render only with JavaScript or need a sign-in come back with a reason, and the agent opens its
own tab. The routing note in the system prompt says: answer from search and fetch; open a
browser only to act, sign in, or read what fetch can't.

## Context

- **A stable prompt.** Page state is appended after `screen_open`, never rewritten into earlier
  messages, so the prompt cache holds between compactions (`opened-pages.ts`,
  `prompt-cache.ts`).
- **The working set** (`working-set.ts`) cuts old results only when a cut saves enough to pay for
  the lost cache; old program results become digests.
- **The condenser** (`condenser.ts`) is one interface over pruning and compaction: older steps
  are summarized every 20 turns past the working budget. `agent.tool` state survives compaction.
- Misty's own data tools are a deferred family, so a web task's first turn carries a small fixed
  cost.

## Completion

A finish is checked, not claimed.

- **Checks without a model call** (`finish-verification.ts`, `count-check.ts`,
  `citation-check.ts`): counts the request asks for ("at least 10") against the answer's rows and
  the results file; sources the answer cites were opened in the run; search results are leads,
  not sources.
- **Proof tabs** (`proof-tabs.ts`): a tab the request asks to keep is marked with `keep()`. It
  stays awake through idle sleep and the run's end, and the end pictures every kept tab; one
  that is broken or an error page goes back to the agent.
- **One verification turn** then covers what the checks can't. Gaps go back once with the
  specifics.
- **Loop guard and research budget** (`loop-guard.ts`, `research-budget.ts`): the same failing
  action twice, or turns on one URL with no new findings, prompt a change of approach. A run that
  gives up early on a broad task is sent back while it is well under its own estimate.
- A run that answers in plain text after working is asked once to confirm with `agent_finish`.

## Sub-agents and the notebook

- **Sub-agents** (`agent_delegation_tools.go`, `spawnChildTabs.ts`): `agent_delegate` splits a
  broad task (10 pediatricians, 20 schools) across children that run under the parent's lease,
  each with its own tabs, and return structured rows. `agent_wait` picks up longer ones.
  Children inherit the parent's grants, never more.
- **The notebook** (`agent_notebook_tools.go`, `log.work`): the run's plan and findings, shown in
  the conversation, surviving compaction.

## Workflows as memory

`memory.workflow.<name>` holds two things with different owners: the person's saved request
(prompt, inputs, schedule, `agent.tool`), which the agent never changes, and the steps the agent
learned from running it, versioned in `agent_method_lessons`. Saved browser steps replay without
model calls and fall back to the agent at the first step the page no longer matches
(`browser_workflow_replay.go`, `browser-replay.ts`).

## Device jobs

- Each device operation is a job on the device's grant (`deviceGrants.ts`,
  `agent_device_grants.go`). After browser work the desktop holds its next claim open for up to
  25 s (`workerHeldClaim.ts`, `device_job_claim_wait.go`), so the run's next job is handed over the
  moment it is queued.
- One MCP session per run (`mcp-sessions.ts`), and one runtime checkpoint per read-only call, on
  finish (`agent_runtime_tool_start.go`).
- `phase_timer.go` logs where each tool call spends its time.

## Errors and budget

Device failure codes reach the model with their real reason and a next step; "could not
complete" told it nothing (`misty_mcp_server.go`, `tool-outcomes.ts`). Development evals get 200
turns and 4 hours (`model-budget.ts`); plans stay below.

## Measuring

The Odysseys campaign ([odysseys-campaign.md](odysseys-campaign.md)) is the main measure, with
three tiers: iterate on a free model judged by itself after every change; check on the dev split
with Odysseys' official judge; report the house model and one frontier model on all 200 tasks.
The free judge's scores never go next to the leaderboard's. Per task: rubric, perfect, turns,
tool calls, minutes and prompt-cache hit rate.

## Decisions

1. Own harness, any model. Learn from open projects, adopt none.
2. No router: every run starts in `agent.tool.answer` and moves up with `agent_tool_use`.
3. Teach mode runs the tutor's fast lane, never the agent loop.
4. The cursor captures every display on every request.
5. `web.fetch` runs on the device, with a Worker fallback, never on the VPS.
6. Agent names never use UI labels; no aliases.
7. No cloud browsers: all browsing is local, in the agent's own tabs.
8. `browser_run` programs run on the person's computer, in a sandbox that can only use the page
   API on the agent's own tabs. The consequential-action rules apply to every call they make.
9. Misty keeps its own browser engine; the lesson from the leaders is the loop, not the engine.
