# Agent harness — architecture plan

Status: revision 4, October 15, 2026; phases 0 to 7 built overnight on October 16 on the
`agent-harness` branch (not pushed). What landed, what was deferred and the eval evidence are
in [Status, October 16](#status-october-16-2026).

The model decides; the harness decides what the model sees (tools, their descriptions, the
prompt, the context) and carries out what it picks. Runs go wrong today because of what the
harness shows, not the loop. A "who's in this video" question from the cursor took four runs: a
screen look, a web search, a visible browser tab, page snapshots and steps, when one search and
one background page read would have answered it.

This plan splits Misty's agent into architecture groups, names the open-source projects each
group learns from, and replaces one group at a time behind the workflow evals in
`server/apps/agent-runtime/evals/workflows/`. A change ships only when the evals improve. The
browser page layer has its own plan, [agentic-browser.md](agentic-browser.md); the cursor work
finishes the approved [agents-at-cursor brief](../design/agents-at-cursor/BRIEF.md).

Misty keeps its own harness rather than adopting one. Agents must run on any model, and the
popular open harnesses (OpenCode, Pi, Hermes, Codex) are built and tuned for coding. Misty
learns their patterns and keeps the browser, desktop, cursor and personal-data work its own.

## Status, October 16, 2026

Built overnight on the `agent-harness` branch, one commit per phase, every pre-commit suite
passing (Go, agent runtime, frontend, contracts). Nothing is pushed or deployed.

| Phase | Landed | Deferred |
|---|---|---|
| P0 Evals | Runner through the local stack's real API, answer and route scored apart, AI Gateway spend cap, fixture screens, seed script, card handling | Fixture search index; resume fixtures; cold/warm and relabel runs; state checks for account tasks |
| P1 web.fetch | Desktop fetch (`web_fetch.rs`, guards on every hop, address pinning) with readable text and question-matched excerpts; Worker fallback (`server/apps/web-fetch`); routing note | Deploying the Worker; reading the current Misty tab in the background |
| P2 Vocabulary | Every tool renamed (no aliases, migration), `agent.entry`, glossary of UI labels, UI-side words in the progress timeline | Voice tool rename to ask, status, stop |
| P3 agent.tool | `agent_tool_use` / `agent_tool_load`, runs start in answer (browse when a browser is attached), only visible tools reach the model | |
| P4 Cursor | Every typed and spoken request carries every display; `show_on_screen` and the teach mode removed; cursor prompt uses search and fetch for facts the screen doesn't show; no pointing tags in notes | `screen_look` / `screen_open` inside the run (needs the catalog to grow mid-run) |
| P5 Families | One correction per family, each tied to a baseline run | Gemini note until Gemini has runs |
| P6 Condenser | `src/condenser.ts`; agent.tool survives compaction | |
| P7 Workflows | `memory.workflow.*` (renamed methods), `find`, `learn`, versioned learned steps (`agent_method_lessons`) | Reverting a worse version automatically (needs eval scores) |

### Evidence (Haiku 5.5, local stack)

| Task | Before (October 15) | After (October 16) |
|---|---|---|
| video-members | 4 runs, screen hand-offs, no member names | One run, 2 searches and 3 page reads, all nine members with the source, no screen |
| read-linked-page | 8 searches, no answer from the page | Answer from the RFC text itself through web_fetch |
| research-compare-pricing | Luna: 39 calls, 7 minutes | Haiku: correct table with conditions, still 26 calls (vendor pricing pages render in JavaScript, so fetch can't read them) |
| Account tasks (issue, drafts, triage) | not run | Correct in substance: issue #1 in misty-eval-sandbox labeled bug, follow-up drafts only, nothing sent; the judge can't see app results yet |

Spend for the whole night: $3.69 of the $8 budget (AI Gateway balance $5.51).

### Changes made on this computer

- The dev stack (`misty server up`) runs this branch; both new migrations are applied.
- `wrangler dev` serves the web-fetch Worker on 127.0.0.1:8790 for the dev API
  (`server/.env/dev/integrations/web-fetch.env`, git-ignored). Stop it with
  `pkill -f "wrangler dev"`; without it, runs with no device simply don't get web_fetch.
- The CLI was rebuilt into `cli/target/release/misty` (it knows the new env file); the `misty`
  in `~/.cargo/bin` is unchanged. Builds ran with a Docker config without the credential
  store, the known workaround for hanging pulls.
- Your local plan was raised to Ultra only during eval passes and is back to Pro.
- The desktop app needs a restart to load the new Rust side (web.fetch on the device, and
  `folder.send` for sending shared files to the Library).
- Google Calendar now uses a Composio-managed auth config; the custom read-only one is disabled.
- Seed data lives in your secondary accounts (Gmail label `Misty eval`, `misty-eval-sandbox`
  with issue #1, `#marketing-drafts`, five calendar events, the Weekly sync note), plus Gmail
  drafts and a "Prep for Pigment call" event in Misty's calendar from the eval runs.

### Next, in order

1. Deploy the web-fetch Worker and set its URL and secret in production
   (`server/apps/web-fetch/README.md`).
2. Restart the desktop app and run the suite with a device, so tab and browser tasks run end to end.
3. State checks for account tasks (read the issue, drafts and events back through Composio)
   so the judge has evidence.
4. Read the current Misty tab in the background (a `browser.tab.read` device tool), and a
   hidden-tab tier for pages that only render in a browser; both cut the remaining over-reach.
5. Decide where "my calendar" should go when the person has both Misty's calendar and Google
   Calendar (schedule-meeting used Misty's).
6. `screen_look` and `screen_open` inside the run; voice tools renamed to ask, status, stop.
7. A full three-model pass, then cold and warm runs for `memory.workflow`.

## Agent vocabulary

The agent's components, its tools, their descriptions and its prompts never use the app's UI
labels. UI names change; renaming a section must not mean refactoring the agent or confusing
it. Names are dotted namespaces, singular, from the general to the specific. The model sees
dots as underscores (`memory.history.search` is `memory_history_search`), and a family of tools
loads by prefix.

| Agent name | What it is | UI label today |
|---|---|---|
| `space.*` | A personal or shared container with members, items and a chat | Spaces |
| `note.*`, `task.*`, `event.*`, `message.*`, `drawing.*`, `roadmap.*`, `bookmark.*` | Items, named for what they are | Notes, Tasks, Calendar, Chat, Drawings, Roadmaps, Bookmarks |
| `file.*` | A stored image, video or document | Library |
| `memory.pref.*` | What the person asked the agent to remember: preferences and facts | Memory (agent preferences) |
| `memory.history.*` | What the person did and saw: pages visited, dictations, captures | Memory, Journal day |
| `memory.workflow.*` | A workflow: the person's saved request and schedule, plus the steps the agent learned from running it | Workflows |
| `log.work.*` | One run's checklist and findings, which the person sees | Notebook card |
| `log.run` | The system record of every model turn and tool call (not a model tool) | None (code: action journal) |
| `agent.tool.*` | What a run can do: `agent.tool.answer`, `.browse`, `.desktop`, `.code`; switched with `agent.tool.use`, families added with `agent.tool.load` | None |
| `agent.entry.*` | Where a request comes from and how the reply returns: `agent.entry.composer`, `.cursor`, `.schedule`, `.email`, `.integration.slack` | Agents page, cursor, island |
| `agent.gate` | Misty's API side of a run: admission and billing, `agent.tool` rules, approvals, `log.run` | None (code: control plane) |
| `agent.finish`, `agent.delegate`, `agent.wait` | Ending a run, and sub-agents | None |

Rules:

1. **Code, tool names, tool descriptions and prompts use agent names only.** Plain nouns for
   what an item is (note, task, event, file) are fine; section labels and brand names (Spaces
   as a label, Journal, Library, Notebook, Workflows) live only in the glossary. `space`
   stays the backend name even if the UI label changes.
2. **One glossary holds the UI labels.** A single file maps each agent name to its current UI
   label and the words people use for it, and is rendered into every prompt: "In the app,
   files are in the Library; Settings › Memory shows memory.history; the Workflows page shows
   memory.workflow." Renaming a UI section changes one line.
3. **Avoid names Misty already uses for something else:** workspace, vault, collection,
   window, pane, view and page (sync); project (code projects); mode (Act / Plan); profile
   (browser and device profiles); skill (Integrations); gateway (Vercel AI Gateway); toolset.
4. **No aliases.** Old tool names are removed, not kept. Saved browser-replay steps and stored
   records that name old tools are migrated in the same change, and dead code is pruned after.
5. **Integrations are typed.** Entry points and tools that come from a connected app sit under
   `integration.<app>`, so `agent.entry.integration.slack` is clearly an integration;
   `agent.entry.email` is Misty's own `+misty` address, not a connected Gmail.
6. **The evals guard it.** The workflow suite has a relabel run: every UI label in the glossary
   is replaced with an invented word, and routing must score the same.

### Workflows as memory

`memory.workflow.<name>` merges two things that are the same idea at different stages: a
request the person saved (with inputs and a schedule) and the procedure the agent learned
from running it. It has two parts with different owners:

- **The request** (prompt, inputs, schedule, `agent.tool`): the person's. The agent never
  changes it.
- **The learned steps** (cached browser steps, which sources worked, what to skip): the
  agent's. Each successful run may write a new version; earlier versions stay, and a run that
  scores worse reverts.

A procedure learned from an unsaved request is a workflow without a schedule; the person can
save it. Workflow similarity matches a new request to the closest stored workflow by its
signature: the kind of task, the site or app, and the shape of its inputs.

## Principle: the server does the minimum

The VPS runs only what a run cannot finish without, so it serves as many people as possible and
one bad request never slows anyone else. Everything that touches pages, screens, files or code
runs on the person's device; work that must happen while their devices are offline runs in an
isolated Cloudflare Worker, never on the VPS.

| Piece | Runs on | Why there |
|---|---|---|
| Agent loop (durable run, model turns, compaction) | VPS, `agent-runtime` | Runs finish while the Mac sleeps (`agent.entry.schedule`, `.email`, `.integration.slack`); model calls use Misty's keys, which never reach a device. The loop mostly waits on I/O |
| `agent.gate` (admission and billing, `log.run`, approvals, `agent.tool` rules and the tool catalog, device job queue), spaces and their items, `memory.*` | VPS, `api` + Postgres | The account's source of truth |
| Model calls, web search | Vercel AI Gateway | Already external; the VPS only waits |
| `web_fetch` | Person's device; Cloudflare Worker when no device is online | A slow or hostile page only affects that run, and a fetch can never reach the VPS's private network |
| Browser pages, desktop control, screen capture | Person's device (Kiri page layer, desktop control) | Already device jobs |
| Coding | Person's device (coding runners on their own subscriptions) | Unchanged |
| Evals | A developer's machine against the isolated live stack | Never production |

Not in this plan, but the same principle points at it later: the Soniox voice relay
(`server/apps/agent-runtime/src/live/`) streams audio through the VPS and could move to a Worker.

## What is wrong today

| Finding | Where | Effect |
|---|---|---|
| No background page reader. `web_search` returns snippets of up to 1,500 characters | `server/apps/agent-runtime/src/web-search.ts` | Reading any page needs `screen_open` and a visible tab |
| Every tool in the catalog is visible on every turn, up to 128 | `modelCatalog` in `src/model-tools.ts` | About 12,000 tokens of prompt and tools; long menus pull models toward elaborate routes |
| `screen_look` and `screen_open` end the run, and Misty starts a new one | `internal/platform/httpapi/screen_tools.go` | One request becomes several runs, each re-planning with a different catalog |
| The cursor only captures the screen when a tool asks. Voice must choose `show_on_screen` or `start_task` before seeing anything | `voice_conversation.go`, `cursorCompanionVoice.ts`, `cursorCompanionTyped.ts` | "Who's in this video" went to `start_task` without a screenshot, then `screen_look` started another run |
| The companion prompt says to err on the side of pointing and to look first | `companion_teach_prompt.txt`, `companionSystemPrompt` | Questions about the world become screen work; `[POINT:none]` leaks into work runs |
| One prompt for every request and every model, assembled from feature flags in Go | `ai_invocation_system_prompt.go` | No short path for a quick answer, no tuning per model family |
| Tool names and prompts use UI labels (Spaces, Library, Notebook, Memory) | Tool descriptors, `agentCapabilityGuidance` | Renaming a section means refactoring the agent, and the agent can confuse UI areas with each other |
| The browser eval starts every task inside a tab with only browser tools | `evals/browser/` | Measures how well the agent browses, never whether it should have |

Strengths to keep: durable runs on Vercel Workflow, the AI SDK loop and any-model routing
through the AI Gateway, per-step `activeTools` (already used by `toolMonitor`), billing
admission per model turn, the action journal (becoming `log.run`), approvals, compaction,
sub-agents, the notebook (becoming `log.work`), agent memory and recall, browser replays, the
Kiri page layer with snapshot refs, and the coding runners.

## `agent.tool` and `agent.entry`

Two separate ideas, which today are mixed together:

- **`agent.tool` says what the agent can do:** its prompt, its tools and its permission rules.
- **`agent.entry` says how the reply comes back:** where the request came from and how the
  answer is delivered.

### `agent.tool`

| Name | Tools | Entered |
|---|---|---|
| `agent.tool.answer` | Core read-only set: `web.search`, `web.fetch`, `memory.pref.list`, `memory.history.search`, `memory.history.timeline`, `memory.workflow.find`, space and item reads, `log.work`, `agent.tool.use`, `agent.finish` | Every request starts here |
| `agent.tool.browse` | Core + `browser.*` (own hidden tab first), `browser.request_user_action`, item writes | `agent.tool.use` when a page must be clicked, signed into or acted on |
| `agent.tool.desktop` | Core + `desktop.*` | `agent.tool.use` when the person asks for work in another app, or an app has no web or API route |
| `agent.tool.code` | Core + `code.delegate`, `code.wait` | `agent.tool.use` for work in an attached project |

Connected apps (`integration.search`, `integration.execute`) and sub-agents (`agent.delegate`,
`agent.wait`) are added with `agent.tool.load` when the run needs them. A saved workflow keeps
the `agent.tool` it runs in. There is no router model: a run that only needs to answer never
pays for a switch, and one that needs more pays one tool call.

### `agent.entry`

| Name | Reply | Screen |
|---|---|---|
| `agent.entry.composer` | Formatted text in the conversation | The current tab, as text the agent can read |
| `agent.entry.cursor` (voice or typed) | Short spoken-style sentences; `[POINT:x,y:label:screenN]` and `[GUIDE:k/n]` when screenshots are attached | Every display captured when the person invokes it, the cursor's first and marked primary, Misty's own windows left out, like Clicky |
| `agent.entry.schedule` | A report to read later | None |
| `agent.entry.email` | A reply from Misty's own `+misty` address | None |
| `agent.entry.integration.<app>` (Slack today) | A reply in that app's own format | None |

Teaching is not its own `agent.tool`: it is `agent.tool.answer` at `agent.entry.cursor`. The
teach mode, its tools-off switch and the continuation runs go away, as the agents-at-cursor
brief already decided. At the cursor, the agent explains and points; it moves to `browse` or
`desktop` only when the person asks for the work to be done. Voice keeps three tools (ask,
status, stop) and every decision moves into the run, which always has the screenshots.

## Architecture groups

| # | Group | Misty today | Learn from | What we take |
|---|---|---|---|---|
| 1 | **Engine**: loop, durability, events | `space-task-agent.ts` on `WorkflowAgent` + Vercel Workflow; action journal in Postgres | OpenHands Software Agent SDK: typed append-only event log, replay, recovery | Keep the loop. `log.run` is the one record runs replay from; screen tools wait inside the run |
| 2 | **`agent.tool`** | One tool list for everything | OpenCode (MIT): agents with their own prompt, model, step budget and allow / ask / deny per tool | `answer`, `browse`, `desktop`, `code`. Start in `answer`, `agent.tool.use` up |
| 3 | **`agent.entry`** | Companion prompt mixed into runs; capture only on request | Clicky (MIT): screenshots of every display on every request, pointing tags | Reply format and screen capture chosen by entry |
| 4 | **Tool catalog** | Dozens of narrow tools, all visible, named after UI sections, mixed singular and plural | Pi (MIT): few broad tools. Goose (Apache-2.0): extensions per task. Anthropic tool search, OpenRouter tool search | Small core per `agent.tool`; families by namespace prefix through `agent.tool.load`, using the AI SDK's per-step `activeTools`; singular agent names, old names removed |
| 5 | **Prompts and vocabulary** | One Go string builder using UI labels | OpenCode: prompt per agent. Pi: under 1,000 tokens | A prompt file per `agent.tool` and per `agent.entry`, a short note per model family, and the glossary of UI labels |
| 6 | **Context and memory** | Compaction, snapshot pruning, agent memory, recall, notebook | OpenHands condensers; Hermes Agent (MIT): episodic, semantic and procedural memory; browser-use (MIT) message manager | One condenser interface for the existing pruning and compaction; `memory.pref`, `memory.history` and `memory.workflow` under one container |
| 7 | **Web and browser** | Kiri page layer, `browser_snapshot` / `browser_steps`; no page reader | Claude Code WebFetch; Mozilla Readability ports; browser-use, Stagehand (MIT), Playwright MCP (Apache-2.0); see agentic-browser.md | Add `web.fetch`. Order: fetch, then the agent's own hidden tab (pages that need JavaScript or a sign-in), then a visible tab, then desktop |
| 8 | **Desktop** | `browser_act` on the desktop through Midscene | UI-TARS Desktop (Apache-2.0), Agent S (Apache-2.0) | `agent.tool.desktop`, entered on request |
| 9 | **Orchestration** | `agents_delegate`, sub-agent tabs, notebook | Polar's published design; Nanobrowser planner / navigator; OpenCode subagents | Sub-agents get an `agent.tool`, not the whole catalog; the navigator reuses an existing model sense with an override in Settings › Agents › Models |
| 10 | **Workflows** | Workflows with schedules, browser replays | Goose recipes (Apache-2.0); Stagehand action cache | `memory.workflow`: the person's request and schedule plus versioned learned steps |
| 11 | **Safety** | Approvals, Ask before acting, untrusted page data | OpenCode permission rules; Codex sandbox policy | Rules attach to each `agent.tool`, so an `answer` run cannot send, pay or click |
| 12 | **Evals and tracing** | Browser, code, pointing and voice suites | OpenHands and browser-use benchmark practice | A workflow suite from every `agent.entry` that scores routing and answers, with relabel, cold and warm runs |

Licenses: copy code only from MIT or Apache-2.0 projects, with a `THIRD_PARTY_NOTICES` entry and
the upstream commit. BrowserOS and Skyvern are AGPL-3.0: design only. Polar is closed source:
its published design only. Check each license file again before copying.

## `web.fetch`

- **Input:** a URL and what to find on the page. **Output:** the page's title, its URL after
  redirects, and either the readable text or, for long pages, the parts that answer the
  question, marked as untrusted page data.
- **Pipeline:** HTTP GET with no cookies or saved sign-ins, a timeout and a size cap; readable
  text through a Readability port (`legible` or `readabilityrs`, both Apache-2.0, or `readex`,
  MIT or Apache-2.0); long pages go through a small model with the question, as
  `browser.extract` already does.
- **Where:** the person's device, as a device job, by default. When no device is online, a
  Cloudflare Worker does the same. The VPS only passes results back to the run.
- **Guards on both paths:** public addresses only. The resolved address is checked against
  private, loopback and link-local ranges before connecting and after each redirect, in our own
  code (Cloudflare does not document a platform guarantee). HTTP and HTTPS only.
- **When it can't:** pages that render only with JavaScript or need a sign-in come back with a
  reason, and the agent moves to its own hidden tab in `agent.tool.browse`.

## Existing features

| Feature (reference studied) | Change |
|---|---|
| Dictation everywhere (OpenWhispr) | None; not an agent run |
| Voice to notes and capture sessions (Anarlog) | None to the pipeline; notes become readable by the agent's `note.*` reads |
| Memory and recall (Screenpipe) | `recall.*` becomes `memory.history.*` and joins `agent.tool.answer` at every entry, not only the cursor |
| The cursor agent (OpenClicky) | The main change: capture on invoke, `screen.look` in the run, voice down to ask, status and stop, pointing as `agent.entry.cursor`'s reply format |
| Coding runners (ccgui) | None to the runners; `code.delegate` and `code.wait` move into `agent.tool.code`, whose rules match each runner's Ask and Auto levels |

## The target shape

```
request: agent.entry.composer | .cursor | .schedule | .email | .integration.<app>
  → agent.entry: reply format; the cursor attaches every display's screenshot
  → engine on the VPS: AI SDK loop on Vercel Workflow, one log.run
      starts in agent.tool.answer: core read-only tools + the entry's note
                                   + the model family's note + the glossary of UI labels
      may call: agent.tool.use (browse, desktop, code)
                agent.tool.load (integration.*, agent.delegate)
  → agent.gate (VPS) on every call: admission, agent.tool rules, approvals, log.run
  → executors
      external:  Vercel AI Gateway (models, web.search)
      device:    web.fetch, Kiri page layer, screen capture, desktop control, coding runners
      Worker:    web.fetch when no device is online
      VPS:       space and items, memory.*, log.work, integrations (Composio)
```

## Phases

Each phase is kept only if the workflow evals improve on success rate without a drop in any
category, and the median run gets no slower or more expensive.

0. **Workflow evals.** Build the runner for `evals/workflows/` (tasks are written) against the
   isolated live stack: start runs from each `agent.entry`, record every tool call and run from
   the action journal, score answers and routes. Baseline today's harness on three model
   families.
1. **Reading without a screen.** `web.fetch` on the device with the Worker fallback. A routing
   note: answer from search and fetch; open a browser only to act, sign in, or read what fetch
   can't.
2. **Vocabulary, `agent.tool` and `agent.entry`.** Rename every tool to its singular agent name
   and remove the old names, migrating stored replay steps and records in the same change.
   Prompt files per `agent.tool` and `agent.entry` replace the Go string builder; the glossary;
   `agent.tool.use`; permission rules per `agent.tool`. Pointing instructions only at the
   cursor. The relabel eval run starts here. Dead code is pruned after.
3. **Small tool catalog.** Each `agent.tool`'s core set is visible; families load by prefix
   through `agent.tool.load` with `activeTools`. The catalog stops sending every tool every turn.
4. **The cursor, finished.** Capture every display on invoke; `screen.look` and `screen.open`
   wait inside the run; voice down to ask, status and stop; the teach mode removed.
5. **Prompts per model family.** Short per-family notes, tuned against the evals.
6. **Context.** One condenser interface over the existing pruning and compaction.
7. **Workflows as memory.** `memory.workflow`: saved requests and learned steps in one place,
   versioned, matched by signature. Cold and warm eval runs measure each workflow's learning
   curve.

## Decisions (October 15, 2026)

1. **Own harness, any model.** No Claude-only engine; learn from open projects, adopt none.
2. **No router.** Every run starts in `agent.tool.answer`; `agent.tool.use` moves up. A saved
   workflow keeps its `agent.tool`.
3. **Teaching is `agent.tool.answer` at `agent.entry.cursor`,** not its own mode.
4. **The cursor captures every display on every request,** the cursor's first, like Clicky.
   The agents-at-cursor brief is amended to match.
5. **`web.fetch` runs on the device,** with a Cloudflare Worker fallback, never on the VPS.
6. **Helper models** (navigator, extraction) reuse an existing model sense, with an override
   in Settings › Agents › Models.
7. **The server does the minimum** (table above).
8. **Agent names never use UI labels.** Dotted singular namespaces; one glossary maps UI
   labels; `space` stays the backend name.
9. **No aliases.** Old tool names are removed and stored references migrated; dead code is
   pruned afterwards.
10. **Integrations are typed:** `agent.entry.integration.<app>` and `integration.*` tools.
11. **Workflows are memory:** `memory.workflow` holds the person's saved request and the
    agent's learned steps, with separate owners.

## Evidence behind the design

| Choice | Evidence |
|---|---|
| Fewer visible tools, loaded on demand | Anthropic's tool search raised accuracy on large MCP tool sets from 49% to 74% (Opus 4) and 79.5% to 88.1% (Opus 4.5), with about 85% fewer tokens for definitions. RAG-MCP (2025) reports 13.6% to 43.1% by exposing only relevant tools. OpenRouter offers the same deferral for any model, so it isn't Claude-specific |
| Start simple, add steps only when needed | Anthropic, "Building effective agents": find the simplest solution and add complexity only when it pays |
| Each `agent.tool` with its own prompt, tools and permissions | OpenCode's build / plan agents and allow / ask / deny rules, used at large scale |
| Plain, distinct, namespaced tool names | Tool-selection studies name similar or overlapping tools and vague descriptions as a main cause of wrong picks; namespaces also let a whole family load by prefix |
| Screenshot on every cursor request, model judges relevance | Clicky's source: `captureAllScreensAsJPEG()` on every push-to-talk request, all displays, own windows excluded |
| URL plus question, readable text, small model for long pages | Claude Code's WebFetch: HTML to Markdown, truncate, small model answers from the page only |
| JavaScript-only pages need a real browser | Fetch-based readers return an empty shell for client-rendered pages; hence the hidden-tab tier |
| Event log as the run's memory | OpenHands Software Agent SDK (MLSys 2026): event sourcing cut system-attributable failures with negligible overhead |
| Worker as the offline fetch path | Workers don't count time spent waiting on `fetch` toward CPU limits; 6 simultaneous outbound connections per request |

Numbers above are from the cited vendors' own tests unless noted; the workflow evals are what
decide for Misty.

## Sources

- Anthropic, [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
- Anthropic, [Building effective agents](https://www.anthropic.com/research/building-effective-agents)
- OpenRouter, [Tool search](https://openrouter.ai/docs/guides/features/server-tools/tool-search)
- [The over-tooled agent problem](https://tianpan.co/blog/2026-04-19-over-tooled-agent-problem) (summarizes RAG-MCP and BFCL); [The complete guide to tool selection in AI agents](https://machinelearningmastery.com/the-complete-guide-to-tool-selection-in-ai-agents/)
- OpenCode [agents](https://v2.opencode.ai/agents); [architecture overview](https://forums.basehub.com/anomalyco/opencode/8)
- Pi: [agentic-ai notes](https://agentic-ai.readthedocs.io/en/latest/AgentHarness/pi-dev/), [ZenML case study](https://www.zenml.io/llmops-database/building-pi-a-minimal-extensible-coding-agent-framework)
- Goose: [introduction](https://mintlify.com/block/goose/introduction)
- OpenHands SDK: [events](https://docs.openhands.dev/sdk/arch/events), [MLSys 2026 paper](https://proceedings.mlsys.org/paper_files/paper/2026/hash/8ae9cf363ea625161f885b798c1f1f78-Abstract-Conference.html)
- Hermes Agent: [agentic-ai notes](https://agentic-ai.readthedocs.io/en/latest/AgentPlatforms/hermes-agent/)
- browser-use: [overview](https://deepwiki.com/browser-use/browser-use/1-overview); Stagehand: [caching](https://docs.stagehand.dev/v3/best-practices/caching.md); BrowserOS: [repository](https://github.com/browseros-ai/BrowserOS)
- Clicky: [farzaa/clicky](https://github.com/farzaa/clicky) (`CompanionScreenCaptureUtility.swift`, `CompanionManager.swift`)
- Claude Code WebFetch: [Inside Claude Code's web tools](https://mikhail.io/2025/10/claude-code-web-tools/)
- Readability ports: [legible](https://docs.rs/crate/legible/0.5.0), [readabilityrs](https://github.com/theiskaa/readabilityrs), [readex](https://docs.rs/crate/readex/latest)
- Cloudflare Workers [limits](https://developers.cloudflare.com/workers/platform/limits)
- Polar: [TechRepublic](https://www.techrepublic.com/article/news-polar-ai-browser-security/), [RuntimeWire](https://runtimewire.com/article/kevin-jiang-polar-raises-5-7-million-ai-browser-knowledge-work)
