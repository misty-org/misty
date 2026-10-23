# Agent harness v3: learning from the Odysseys leaders

October 20, 2026. Draft for approval. Follows [agent-harness-v2.md](agent-harness-v2.md), whose
step 6 (one small tool surface) was never built.

## Status (October 20, built, not yet measured)

- **1. browser_run:** built. Device: `src/features/agents/programs/` (QuickJS sandbox, page API,
  host), `browserJobRun.ts` (the shared path for one page operation). Server: `browser_run.go`,
  the workspace grant and allowlists. The page API has no `screenshot()` or page `js()` yet.
- **2. Tool surface:** a run with `browser_run` starts without the 17 single-step tools; they load
  with `agent_tool_use("browse")`.
- **3. Stable prompt:** older steps are summarized every 20 turns past the working budget, and old
  program results become digests. Page state is still added after `screen_open` (appended, so
  the cache holds).
- **4. Completion:** count and broken-proof-tab checks join the one verification turn.
- **5. Proof tabs:** `keep()` keeps a tab awake through idle sleep and the run's end.
- **6. Errors and budget:** device failure codes reach the model with a next step; dev evals get
  200 turns and 4 hours (migrations `20271103000000`, `20271103000100`).
- **7. Apps:** a request naming an app starts with the app tools loaded.
- **Own tabs only:** `screen_open` no longer takes the person's tab, and the "current" screen
  location opens a tab of the agent's own.

## Where we are

Three Odysseys tasks on Nemotron 3.5 Super VL (120B, 12B active): best 0.75, 0.78 and 0.43 of
the rubric, no task perfect. Every harness fix today raised a task's score with the same model
(0.25 → 0.75, 0.33 → 0.78), so the harness is still the main limit. Measured today:

- 64 tools and 45,000 characters of tool definitions in every request, plus a 15,700-character
  system prompt.
- Device actions are fast now: snapshot 0.6 s, steps 1.1 s, a new tab 0.5 s (medians).
- The time between two tool calls is 5 s at the median and 23 s at p90: almost all of it is the
  model's turn. Runs take 30 to 80 tool calls, one per turn or a few in parallel.
- The model copies a 36-character documentId and refs into every action; it garbled them, and
  every action on a site failed until the harness learned to repair them.

## How the leaders work

| | Odysseys perfect | What the model gets | How it acts | How it sees |
|---|---|---|---|---|
| Skyvern 3.0 (Opus 5) | 90.5%, 65 steps | 4 tools: scan the page with its own JavaScript, browser actions, screenshot, finish | Clicks, typing, scrolling and tab switches through its Rustwright layer; page reads are model-written JS | Starts with almost nothing and asks: HTML through its own script, a screenshot only when needed (2.7% of calls) |
| BrowserCode (Browser Use) | 86.0% (GPT-5.6), 65.0% (Opus 4.7) | `browser_execute(code)` plus a coding agent's file tools | JavaScript over the DevTools Protocol; helpers it may edit; reusable scripts in a workspace | Whatever its code reads: the accessibility tree first, HTML when needed, screenshots returned by the call |
| dassi (Gemini Flash) | 85.0% | Not published | One step is one model call that "can run a small program that clicks through a whole page" | Structure (elements, labels, state), not screenshots |
| Webwright (Microsoft, GPT-5.4) | 60.1% (base model 33.5%) | A terminal | Playwright code; loops and functions; several pages per script | Logs, values, tracebacks, screenshots when needed |
| Opus 4.6 computer use | 44.5% | Screenshot and click | One action per turn | A screenshot every turn |

What they share:

1. **Few tools, and code as the action.** One call can open a page, fill a form, page through
   results and extract twenty rows. A 30-turn task becomes a few turns, and a list of ten items
   is a loop instead of ten rounds.
2. **Observation on demand.** Nothing is pushed into every turn. The prompt stays the same from
   turn to turn, so the prompt cache holds: Skyvern's cache hits rose from 27% to 80% and its
   cost fell 22% though runs took more turns.
3. **No wrappers between the model and the browser.** Browser Use removed its element indexers
   and click wrappers ("don't wrap the LLM, don't wrap its tools either"): the model already
   knows the DevTools Protocol and how to fix code, and real errors are information.
4. **Completion is checked, not claimed.** Webwright only accepts done after a fresh run of the
   final script with logs and screenshots and a written self-check; dassi's lessons are that
   conclusions must come from pages actually visited and required end states (tabs left open)
   must be visible.
5. **Long budgets.** dassi: 85% with no step limit, 75% at 100 steps. Webwright compacts its
   context every 20 steps.

## How Misty differs

| | Leaders | Misty today |
|---|---|---|
| Tools | 1 to 4 for the browser | 17 browser tools (snapshot, steps, fill_form, find, extract, wait_for, navigate, tab_open, inspect, visual, act, skill, …) inside 64 |
| Action | A program per call | One batch of steps per call, each needing documentId and refs copied from a read |
| Observation | Asked for | Page state pushed after actions; snapshots kept in history; the working set rewrites earlier messages |
| Errors | Raw | Often "The tool could not complete this action." |
| Completion | Gated on evidence | One model review; the next finish stands even if short (8 of 10 items) |
| Proof tabs | Visible at the end | Asleep after 20 s idle; 1 of 25 tabs pictured at the end of a run |
| Turns | 65 to 125 per task | 120 at most |

The leaders run Chrome. Nothing in our failures came from WebKit, and Misty keeps its own
browser (campaign rule 8); the lesson to take is the loop, not the engine.

## Changes, in order

### 1. `browser_run`: a program per call

The agent writes a short JavaScript program against a small page API, and Misty runs it on the
computer the run works on, inside the Misty app, in a sandbox with no network, files, app state
or globals: only the API below, and only on the agent's own tabs. Each API call is the page
operation that exists today (open, read, act, wait, extract), run locally instead of as a
server round trip, and every consequential click still passes the pay/send/delete/post rules.

```js
const tab = await open("https://www.oldnavy.com");
await tab.type({ role: "searchbox" }, "women's joggers", { submit: true });
await tab.waitFor({ text: "results" });
const items = await tab.extract("each product: name, price, link", { limit: 10 });
return items.filter((item) => item.price < 40);
```

- `open(url)`, `tabs()`, `tab.goto`, `tab.read()` (the accessibility tree, as today),
  `tab.find(query)`, `tab.click / type / fill / select / key / scroll / hover(target)`,
  `tab.waitFor`, `tab.extract(question)`, `tab.js(fn)` (read-only page script),
  `tab.screenshot()`, `note(row)` (the run's results file), `keep(tab)` (proof).
- Targets are found by role and name, text, or a ref from a read; the program never copies
  document ids. A target that is gone fails with the real reason.
- The call returns the program's value, its logs, the real error and stack if it threw, and a
  short state of the last tab it touched.
- A program has a time limit per call (two minutes) and a cap on operations; a long task is
  many short programs.

### 2. One small tool surface

For a browsing run: `browser_run`, `web_search`, `web_fetch`, `agent_delegate` (sub-agents for
breadth), `browser_request_user_action`, `log_work_checklist`, `agent_finish`. The 17 browser
tools leave the default surface (still loadable for edge cases). Target: under 10,000
characters of tool definitions.

### 3. Observation on demand and a stable prompt

No automatic page-state pushes; `browser_run` returns what the program asked for. Earlier
messages are never rewritten turn to turn; instead the transcript is compacted into one summary
every 20 turns (Webwright), so the prompt cache holds between compactions.

### 4. Completion on evidence

Before a finish stands, without a model call: every page the request asks to keep open is a
kept tab that is awake, pictured and not an error page (reopened if not); counts the request
asks for ("at least 10") are checked against the answer's rows and the results file; every
source the answer cites was opened in the run. Gaps go back once with the specifics; the model
review stays for the rest.

### 5. Proof tabs that stay visible

`keep(tab)` marks a tab as proof: it never sleeps during the run, and the run's end pictures
every kept tab. Other tabs sleep as today.

### 6. Real errors and a longer budget

Tool failures carry their real reason to the model (the server's mapping today hides most).
Eval runs get 200 turns (migration: the 120 cap in the runtime, server and database).

### 7. Connected apps before the browser

Connected apps (Composio, through the gateway's `integration.*` tools) stay a family the run loads
when it needs it, so web tasks never carry them. Two changes:

- A request that names an app the person has connected ("email Sam", "add it to my calendar")
  starts with that family loaded, and `integration.search` returns the schema of its top
  matches, so the first action comes one turn after the request instead of three or four.
- The prompt prefers a connected app's API to its website: an agent never drives Gmail's pages
  when Gmail is connected.

Odysseys never exercises apps. The workflow suite's 10 app tasks (with connected test accounts)
measure this part, alongside a new Spaces set.

## The architecture diagram

The diagram in [agent-architecture/BRIEF.md](../design/agent-architecture/BRIEF.md) still shows
Midscene `screen.act` doing the clicking and "all tools active on every turn". Once this plan
is approved, it becomes:

```
Composer (one input, no modes)
  └─ Agent loop (Vercel Workflow): small tool surface, prompt stable between compactions,
     │  transcript compacted every 20 turns, progress note when a turn only narrates
     ├─ browser_run ─ Capability gateway (Go: catalog · policy/approvals · journal · billing)
     │    └─ Device: the program in a sandbox inside the Misty app (no network, files or globals)
     │         └─ Page API: open · read · find · click · type · fill · wait · extract · keep · screenshot
     │              └─ The agent's own tabs only (page layer, native input, consent and popup
     │                 handling, proof tabs that stay awake)
     ├─ web_search · web_fetch · agent_delegate (sub-agents for breadth)
     ├─ Misty data tools and Composio apps (loaded when the request is about them)
     └─ Completion gate: kept tabs awake, pictured and not error pages; counts met; sources
        visited; then the one model review
```

## Measuring

The three tasks from October 20 (46ecc9a5dc, 8f005e9f09, d03a08650b) on Nemotron after each
change, then the dev split. Per task: rubric, perfect, turns, tool calls, minutes, prompt-cache
hit rate.

Three tiers, each answering a different question:

| Tier | Agent | Judge | When | Answers |
|---|---|---|---|---|
| Iterate | Nemotron (free) | Nemotron (free) | After every change | Did this change help? Before/after on one model only |
| Check | Nemotron (free) | Odysseys' official judge (Gemini 3.1 Flash-Lite, the official per-rubric script unchanged) | When a change lands, on the dev split | Is our free judge lenient? A judge from another family, as the leaderboard uses |
| Report | Haiku 5.5 (the house model) and one frontier model | Official judge | Once v3 is done, on all 200 | Where Misty stands on the leaderboard, and how much is model vs harness |

The free judge grades its own model's runs, which leans generous, so its scores never go next to
the leaderboard's. The official judge costs little (one Flash-Lite call per rubric); the
Report tier's agent runs are the expensive part (the leaders report $0.66 to $6 a task) and
wait for OpenRouter and a budget.

## Open decisions

1. Decided (October 20): programs run on the person's computer, inside the Misty app, in a
   locked sandbox that can only use the page API on the agent's own tabs: no files, terminal,
   network, app state or the person's tabs. Page operations are then local (tens of
   milliseconds) instead of a server round trip each. The consequential-action rules apply to
   every call the program makes.
2. Decided (October 20): agents act only in their own tabs. `browser_run` and `screen_open` never
   reach the person's tabs; an agent has its own context, and a page moves to the person only
   with Move to my tabs.
