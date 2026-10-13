# Agentic architecture review

Where Misty's agent falls short of Comet and Polar, why, and a concrete system for improving it.
Written October 17, 2026 against `main` at `6945bcb5`, from the code, the existing plans
([agentic-browser.md](agentic-browser.md), [agent-harness.md](agent-harness.md),
[agent-ledger.md](agent-ledger.md)) and published work from teams shipping agents. Competitor
details marked † are third-party (reverse engineering or press), not the vendor's own words.

## Short answers

1. **Kiri vs Chromium and Gecko.** For loading and rendering sites, Misty is about where Safari
   is: WebKit renders the modern web, and the gaps that remain (WebUSB, Web Bluetooth, Web
   Serial, HID, File System Access pickers, passkeys until Apple grants the entitlement) rarely
   decide whether an agent task works. The gap that matters for agents is a different layer.
   Chromium ships an automation and introspection layer (the DevTools Protocol) that every
   leading agent browser uses: the engine's own accessibility tree, trusted input into any tab
   including hidden ones, every frame including cross-origin ones, screenshots of background
   tabs, network bodies, dialogs and file choosers. WKWebView exposes almost none of that, so
   Misty rebuilds it in page scripts. Those rebuilt pieces are where the agent loses information
   today (section 2).
2. **Model, harness or Kiri?** Nobody can say yet, and that is the real gap. The evals are
   too small, too easy and graded by the same model that runs the agent, and there is no
   step that attributes a failure to a cause. What the evidence does show: most fixed failures
   so far were harness and perception problems (routing, JS-only pages, type-ahead fields,
   Docs paste), the model runs at a pinned **low** effort that has never been compared with
   medium or high, and research tasks pass 0–33% tonight. Section 3 gives a method that labels
   every failure as perception, action, reasoning, harness or eval, so the next fix is chosen
   from data.
3. **Tuning one model with several reasoning levels.** Haiku 5.5 cannot be fine-tuned: Anthropic
   offers no fine-tuning API, Bedrock's fine-tuning covered only Claude 3 Haiku (retired
   September 10, 2026), and OpenAI is closing its own fine-tuning platform. For a closed model,
   tuning means fitting the harness to the model: tool shapes close to what it was trained on, a
   per-turn effort policy chosen by the harness (Haiku 5.5 supports `low` through `max` and can
   change effort mid-conversation without losing the prompt cache), offline prompt optimization
   against the evals, and procedural memory. Weight-level tuning only makes sense later, on an
   open-weight navigator model, once Misty has thousands of graded trajectories (section 5).

Section 6 reads every saved eval run for problems that are already clear; section 7 is the
path, starting with those fixes and then measurement.

## 1. Where Misty stands

What the repository shows, October 17:

| Area | Today | Evidence |
|---|---|---|
| Model | One house model, `anthropic/claude-haiku-5.5`, at a fixed `low` effort for every run and every turn | [house_route.go:11](../../server/internal/agents/house_route.go#L11) |
| Loop | AI SDK `WorkflowAgent`, one model call per durable step, up to 120 turns, 8,192 output tokens | [space-task-agent.ts](../../server/apps/agent-runtime/workflows/space-task-agent.ts) |
| Seeing a page | A text accessibility tree computed by Misty's own page script, refs on actionable nodes; screenshots only when the model asks | [page_tree.js](../../src-tauri/src/infra/browser_page/page_tree.js), `browser.snapshot` descriptor |
| Cross-origin frames | Listed as `cross-origin <origin>`, contents not read | [page_tree.js:108](../../src-tauri/src/infra/browser_page/page_tree.js#L108) |
| Input | Native input when the tab is visible; script events in hidden tabs (the agent's own and sub-agents' tabs), which sites checking `isTrusted` ignore | [evals/browser/README.md](../../server/apps/agent-runtime/evals/browser/README.md) |
| Guards added after eval failures | Finish check, citation check, research budget (word-overlap query matching), per-family notes, browser re-inspection | `src/finish-check.ts`, `citation-check.ts`, `research-budget.ts`, `model-family.ts` |
| Tool visibility | Tools appear and disappear mid-run (`agent.tool.use`, research budget closing search and fetch) | `src/toolsets.ts`, `src/research-budget.ts` |
| Browser eval | 17 fixture tasks, 3 runs, 96%; 22 live tasks, of which 6 have ever run once | [agentic-browser-results.md](agentic-browser-results.md) |
| Workflow eval | 33 tasks, account tasks 7/8 from one run each; research and answer runs on October 18 (UTC) at 0–33% | `evals/workflows/reports/` |
| Judge | The agent's own model: Haiku 5.5 judges Haiku 5.5 | [workflow.eval.ts:26](../../server/apps/agent-runtime/evals/workflows/workflow.eval.ts#L26); the browser judge defaults to the first model |

Two things stand out. The fixture tasks average 4.5 model turns, while the products Misty is
compared with publish results on tasks that take dozens to thousands of calls (Polar: "10,000+
LLM calls across 100s of subagents for 10+ hours"). And no Misty number can be put next to
theirs, because Misty has never run a public benchmark.

## 2. Kiri against Chromium and Gecko

Kiri is not an engine. It supplies, from Rust, the browser layer that WKWebView, WebView2 and
WebKitGTK leave out: permission prompts, passkeys, the host channel, the extension
transport ([kiri/README.md](../../kiri/README.md)). Two separate questions follow.

### Rendering and web platform

WebKit on macOS is Safari's engine, and Safari is a top-two browser, so mainstream sites are
built to work in it. Gaps against Chromium are known and narrow: Apple declines generic device
APIs (WebUSB, Web Bluetooth, Web Serial, WebHID) and File System Access pickers; passkeys in
Misty wait on Apple's browser entitlement ([kiri.md](kiri.md)); a few sites sniff for Chrome. On
Windows, WebView2 is Chromium, so rendering there is Chrome's. None of this is why agent tasks
fail. The one compatibility class that does hit agents is pages that assume Chrome (wry's
read-only `window.ipc` breaking Google Sheets was this kind), and fixing those as they appear
is the right policy.

### The automation layer agents actually use

Every production agent browser that has been examined reaches pages through Chromium's
automation layer, not page scripts. Comet's agent extension calls
`Accessibility.getFullAXTree` through `chrome.debugger`, converts it to YAML with refs, sends
screenshots, and acts by ref or by pixel batch (Zenity Labs' reverse engineering †). Claude in
Chrome has the same shape (read page, find, form input, screenshot and coordinate actions).
Polar and Atlas are Chromium too. What that layer gives them, and what Misty has instead:

| Capability | Chromium (CDP) | Misty today | Effect on the agent |
|---|---|---|---|
| Accessibility tree | The engine's own tree: computed roles and names, shadow DOM, ARIA, canvas fallbacks | Rebuilt in JavaScript from the DOM (`page_tree.js`), capped at 25,000 scanned nodes and 800 refs | Good on plain HTML; misses where computed names differ from heuristics, very large pages, closed shadow roots |
| Cross-origin frames | Every frame, through out-of-process frame targets | Origin only | Payment forms, embedded editors, Typeform and HubSpot embeds, sign-in widgets and many enterprise apps are invisible |
| Trusted input in hidden tabs | `Input.dispatch*` events are trusted in any tab | Script events in hidden tabs | Sites that check `isTrusted` ignore clicks and keys from the agent's own tabs and sub-agents; Google apps only work while visible |
| Screenshots of background tabs | `Page.captureScreenshot` on any tab | Visible tabs | Vision is unavailable exactly where the agent works on its own |
| Network | Request and response bodies, interception | None | JSON a page fetched is the cheapest way to read many apps; Misty must read the rendered page |
| Dialogs, file chooser, downloads | Events and handlers | Partly in Misty's own code | Each is a place a run can stall |

The plan already names three of these as Kiri work ([agentic-browser.md](agentic-browser.md),
"Kiri gains a piece only if an engine-level primitive is missing"): an isolated world (done on
macOS), cross-origin frames, and trusted input on WebView2 and WebKitGTK. The review adds hidden-
tab trusted input and capture on macOS, which is the larger one because every sub-agent and
background run lives in a hidden tab.

What each gap costs is unmeasured; section 3's attribution step measures it. Practical
directions, each needing a short spike before it is planned:

- **Frames.** `WKUserScript` with `forMainFrameOnly: false` in the agent's content world runs the
  page runtime in every frame, cross-origin included; the snapshot asks each frame for its
  subtree over the host channel and stitches them, with frame-prefixed refs. WebView2 has
  `CoreWebView2Frame.ExecuteScriptAsync`, WebKitGTK has per-frame user scripts.
- **Hidden tabs.** Keep the agent's tabs as real, composited views in an off-screen or fully
  occluded window instead of hidden ones, so native input and `takeSnapshot` work. This is how
  Polar describes its tasks ("in their own windows in the background"). The memory note
  "never let WebKit stop painting" points the same way.
- **Engine accessibility tree.** WebKit exposes each page's tree to the hosting app through
  macOS accessibility (`NSAccessibility`). Reading the app's own WKWebView subtree could replace
  the JavaScript heuristics for roles and names on macOS. Unknown: speed, and whether occluded
  views keep their tree current.

## 3. Model, harness or Kiri: how to tell

### What the evidence says so far

| Failure seen | Cause class | Source |
|---|---|---|
| "Who's in this video" took four runs and a visible tab | Harness (routing, catalog) | agent-harness.md |
| Pricing pages took 26 calls because fetch can't render JavaScript | Perception tier (no hidden-tab reader, ledger R2) | agent-harness.md |
| Type-ahead fields failed with `select`; Docs ignored scripted paste; Sheets never started | Action layer and engine compatibility | agentic-browser-results.md |
| Paged table dropped one item | Model attention | agentic-browser-results.md |
| Runs claimed work no tool did, then called `agent_finish` again to get past the check | Model behavior, patched in the harness | agent-ledger.md A3 |
| Research answers ungrounded or incomplete | Unknown: no attribution | October 18 reports |

So far the harness and perception layers caused most of what was found and fixed. That does not
make the model blameless: Haiku is the smallest current Claude, and it runs at `low`, below
Anthropic's own default of `medium` for this model. Lower effort means fewer and shorter tool
calls, which is right for chat and wrong for long research. It has never been measured here.

### Patterns in the harness that make diagnosis harder

- **Fixes accumulate as one-off guards.** The finish check, citation check, research budget and
  family notes each answer one eval failure. Browser Use's team, which climbed Online-Mind2Web
  with an automated loop, reports that most of their merge time goes to rejecting fixes like
  these, because they overfit the tasks they came from. With 33 workflow tasks and single runs,
  Misty cannot yet tell a real gain from noise.
- **The tool list changes mid-run.** `agent.tool.use` swaps tool sets and the research budget
  removes search and fetch. Providers cache the request prefix, and tools come first in it, so
  each change likely re-bills the whole transcript at full price. Manus calls cache hit rate the
  single most important production metric and keeps tool definitions fixed, constraining choice
  instead ("mask, don't remove"). Check `cache_read_input_tokens` on the turn after a switch to
  confirm.
- **Tool shapes are Misty's own.** The model sees `browser_snapshot`, `browser_steps` and so on.
  Claude models are trained heavily on Claude in Chrome's tool shapes and on Anthropic's computer
  toolset. Browser Use's single biggest gain came from moving toward the model's training
  distribution (letting it write Python to parse pages) rather than away from it.
- **The judge is the agent.** Haiku grades Haiku with no human-labelled calibration set, so a
  systematic blind spot in the model is also a blind spot in the score.

### The attribution method

Every failed run gets one primary label:

| Label | Meaning | Typical fix |
|---|---|---|
| **P** perception | What the model needed was not in what it saw: frame, canvas, truncation, stale snapshot, JS-only page | Kiri or page layer |
| **A** action | Right intent, the action didn't land: untrusted event, wrong target, timing | Page layer, input |
| **R** reasoning | Information present and tools working; the model chose wrong, stopped early or made something up | Effort, prompt, skills, model |
| **H** harness | Tool hidden or closed, budget cut, compaction lost the plan, wrong route | Runtime |
| **E** eval | Task ambiguous, grader wrong, site changed | The suite |

Labels come from an ablation ladder run on failures only, so it stays cheap:

1. **Same run, higher effort** (`medium`, then `high`). Passes now → **R**, effort-limited.
2. **Same run, stronger model** (Sonnet 5.5 or Opus 5.5 at `high`, eval only). Passes → **R**,
   model-limited. Fails the same way → not the model.
3. **Same run, oracle perception**: each observation adds a screenshot and full page text,
   frames included, from Misty's own webview. Passes → **P**.
4. **Trace review** by a coding agent for the rest, with a fixed rubric for **A**, **H** and **E**,
   and a human spot-check of a sample.

The weekly output is one table: failures by label, by category, and by site. The top row of that
table is the next piece of work. This replaces guess and check with a ranked backlog.

## 4. Production architectures to learn from

| System | What is known | What Misty takes |
|---|---|---|
| **Comet** (Perplexity) † | Chromium with private extensions; backend model plans and sends RPC over WebSocket; pages read as the CDP accessibility tree in YAML with refs, plus page text as Markdown and screenshots; actions by ref (`FormInput`) or pixel batches (`ComputerBatch`); `CreateSubagent`; hard URL blocks for internal pages | Misty's shape already matches (snapshot refs, fill form, steps, sub-agents). The difference is perception depth: engine tree, every frame, screenshots alongside text |
| **Polar** (Recursive Intelligence) | Chromium fork; orchestrator with many sub-agents; mixes frontier models "by comparative strength"; long tasks run on the user's device because cloud machines hit 2FA, SSO and IP blocks; publishes Odysseys 196/200 and BU Bench V1 95/100 (self-reported, [polar-evals](https://github.com/recursive-hq/polar-evals)); lists a "self-improving harness" that triages trajectories and proposes changes checked against evals | On-device execution validates Misty's no-cloud-browser choice. Run the same public benchmarks; build the self-improving loop |
| **Browser Use** | Online-Mind2Web 97% (self-reported). Claude Code drives the eval CLI in parallel sessions of 20 cycles; asked for large changes, not tweaks; trace data in three levels of detail, TSV instead of JSON (−40% tokens); an agentic judge aligned with human labels; a train split for the loop and older datasets as holdout; biggest gain from letting the agent run code to parse HTML | The improvement loop in section 7, nearly as described |
| **Claude in Chrome** (Anthropic) | Probes scan tool results for prompt injection and make the model suspicious when one fires; attack success about 1% internally; blocks high-risk categories such as banking | Misty's untrusted-content marking and consequential gate are the same idea; add the injection tasks to the capability suite |
| **Manus** | Cache hit rate as the main metric; stable prefix, append-only context; fixed tool list with masking; files as external memory; rewriting a todo list to keep the goal in recent attention; keep errors visible | Stable tool list; `log.work` as recitation; errors kept in context |
| **Anthropic, agent evals guidance** | Start with 20–50 tasks from real failures; code graders first, model graders calibrated against humans with one judge per criterion; pass^k for agents that must always work; clean environment per trial; read transcripts before trusting a score; graduate saturated capability evals into regression | The eval tiers and statistics in section 7 |

Public benchmarks that fit Misty's work, all on live sites:

| Benchmark | Size | Grading | Published reference points |
|---|---|---|---|
| BU Bench V1 ([browser-use/benchmark](https://browser-use.com/posts/ai-browser-agent-benchmark)) | 100 hard tasks from five sources | Judge over final output and trace | Polar 95, aside with GPT-5.5 93, Browser Use Cloud 78 |
| Odysseys ([paper](https://arxiv.org/abs/2604.24964)) | 200 long multi-site tasks from real browsing | About 6 rubric items per task, each judged separately | Paper's best model 44.5%; Polar 98% with its own run |
| Online-Mind2Web | 300 tasks on 136 sites | Judge | Browser Use 97, GPT-5.4 computer use 93 |

These numbers come from different harnesses and judges, so they are reference points, not a
leaderboard Misty can enter. Running them in Misty's own browser still answers the question the
user is asking: how far from Comet and Polar is Misty, on the same tasks.

### How the benchmarks work

**Odysseys** (Jang, Koh, Fried, Salakhutdinov; CMU, ICML 2026). 248 people on Prolific labelled
their own Chrome history into 2,380 browsing journeys. The authors kept 696, chained related ones
into multi-site workflows, added 30 hand-written and 80 generated hard tasks, and reviewed each
by hand, for 200 tasks phrased as a person would ask ("look up the top 10 banana bread recipes
and compare them"). Each starts from a Google search page or a given URL, on the live web. In the
paper, agents run in an Ubuntu VM with Chrome, see screenshots, act with GUI actions, and get 100
steps at maximum reasoning effort. Each task has 3–12 rubric items (6.1 on average), each a
checkable requirement with a note on how to verify it; a judge model (Gemini 3.1 Flash-Lite)
grades every item on its own from the screenshots and action history. Two scores come out: the
average rubric score, and **perfect success**, where every item passes. A third, trajectory
efficiency, divides the rubric score by the steps taken. Results: Opus 4.6 44.5% perfect, GPT-5.4
33.5%, Sonnet 4.6 31.0%. The authors' failure notes are the useful part: Opus keeps researching and
never delivers before the step budget runs out; GPT-5.4 writes a good plan and stops acting; both
stall on high-fanout tasks (visit all 30 stadiums). Tasks and scripts are public at
[odysseysbench.com](https://odysseysbench.com/); the license still needs checking. For Misty it
measures long, multi-site research and comparison, which is what Polar sells.

**BU Bench V1** (Browser Use, January 2026). 100 tasks picked to be hard but possible, 20 each
from five sources: Browser Use's own interaction tests (iframes, drag and drop, complex forms),
WebBench, Mind2Web 2, GAIA and BrowseComp. Each task was run many times across models and
frameworks; tasks that were too easy, or that no run ever completed, were dropped. The task file
is encrypted so models can't train on it. A judge (Gemini 2.5 Flash) gives a binary pass or fail
from the final answer and trace; it agreed with 200 hand-labelled traces 87% of the time. A full
run takes about three hours. Published scores: Fable 5 80%, Browser Use Cloud 78%, Opus 4.6 62%,
Sonnet 4.6 59%, GPT-5 52%. A longer v2.1 (180 tasks) now exists. For Misty it measures broad
browsing skill, including frames and widgets, which section 2 says are weak spots.

**Online-Mind2Web** (Ohio State and Berkeley, 2025). 300 tasks on 136 real sites, split into
easy, medium and hard by the steps a person needs, graded by an LLM judge that checks the task's
key points against the trajectory. It is the most cited of the three and the most saturated
(several systems claim 90%+), so it is the least useful for telling Misty's changes apart.

What all three have in common, and what Misty's suites lack: tasks someone else wrote, run on the
live web, many trials, and a judge that is not the agent's own model.

## 5. Tuning one model with several reasoning levels

### What is possible for Haiku 5.5

| Lever | Available | Notes |
|---|---|---|
| Fine-tuning or RL on Haiku 5.5 weights | No | No Anthropic fine-tuning API; Bedrock's only covered Claude 3 Haiku, now retired |
| Effort per request | Yes | `low`, `medium`, `high`, `xhigh`, `max`; default `medium`; Misty pins `low` |
| Effort per turn without losing the cache | Yes, beta | A mid-conversation effort message (`mid-conversation-output-config-2026-07-01`) on Haiku 5.5 with thinking on, on the Claude API and Google Cloud. Through the AI Gateway it needs checking; the runtime now has a direct Anthropic path (uncommitted change in `model-provider.ts`) |
| Task budget | Yes, beta | A token ceiling the model paces itself against, instead of being cut off |
| Computer use toolset | Yes | `computer_toolset_20260801` on the Claude API; the shape Claude models train on for screens |
| Advisor | Yes, beta | Haiku 5.5 as executor consults Sonnet 5.5 or Opus 5.5 mid-generation, capped by `max_uses` and `max_tokens`. The agent stays one model to the person; the advisor is an internal escalation |
| Server compaction and context editing | Yes, beta | Could replace parts of `condenser.ts` |
| Prompt optimization | Yes, offline | GEPA (ICLR 2026) reports beating GRPO by 6 points on average with up to 35× fewer rollouts, by reflecting on traces and evolving the prompt |

### A reasoning policy the harness owns

People never choose effort (the one-house-model decision stands). The harness chooses it per
turn, from the kind of turn:

| Turn | Effort | Why |
|---|---|---|
| First turn of a task with tools: plan, pick the route | `high` | One expensive turn decides the whole run's path |
| Navigation inside a sub-goal: click, fill, scroll, read the result | `low` | Many cheap turns; the plan is already made |
| After a failed or rejected action, or a stale page | `medium` | Re-plan locally |
| Before `agent_finish`: check the answer against the request and evidence | `high` | Replaces the refuse-once finish and citation checks with real verification |
| Extraction (`browser.extract`), titles, summaries | `low` | One-shot reads |
| Sub-agent navigators | `low`; the parent plans at `high` | Nanobrowser's planner and navigator split, on one model |
| Plain chat with no tools | `low` | Unchanged |

This is "one model, several reasoning levels" in practice. It is decided by measurement: the
first experiment is a sweep of the whole run at `low`, `medium` and `high` on the capability
suite, reporting pass rate and cost per completed task. Haiku 5.5's prices ($0.10 / $0.50 per
million tokens, cache reads lower still) make a higher effort on a few turns cheap next to a
failed run the person has to redo. If the sweep shows `medium` everywhere is enough, keep the
simpler rule.

### Fitting the harness to the model

- **Tool shapes.** Run an A/B on the browser suite: Misty's current page tools against a set
  shaped like Claude in Chrome's (read page, find, form input, a computer tool with screenshot
  and coordinate batches, get page text) backed by the same page layer. Keep whichever wins.
- **Code for data.** Let the agent run a small sandboxed script over page HTML or extracted
  tables for bulk extraction and checking, which was Browser Use's largest single gain. The
  coding runners already sandbox code; a read-only variant with no network fits here.
- **Procedural memory.** Ledger W1–W2 (learn and find workflows automatically) is the part of
  "tuning" that compounds: each repeated task starts from steps that worked last time.
- **Prompt optimization.** Once the suite has a train and holdout split, run reflective prompt
  evolution on the per-mode prompt files (ledger P1) rather than hand-editing them.

### Weight-level tuning, later

Polar's stated long-term model plan is specialized models trained for speed. For Misty that
would mean an open-weight navigator (fine-tuned on Fireworks, Together or self-hosted with
GRPO) trained on Misty's own graded trajectories, while Haiku stays the planner. It needs
thousands of graded, attributed trajectories first, which section 7 produces, and it adds serving
cost, so it is not on the path until the cheaper levers stop moving the numbers.

## 6. What the existing runs already show

Before spending on public benchmarks, every saved report was read: 21 workflow reports (177 runs,
136 of them on Haiku 5.5, October 16–18) and 35 browser reports (196 runs, October 10). Each failed
Haiku run was given a provisional label from section 3 using the judge's reasons and the tool
sequence. The labels are one reader's call from logs, not the ablation ladder, so treat the
counts as approximate.

### The suites themselves

- **The browser suite has never run on the house model.** All 196 browser runs used
  `gpt-6-luna`, before the October 16 tool rename and the switch to Haiku. Whatever it says about
  the page layer, it says nothing about Haiku driving it.
- **The browser fixtures are saturated.** 15 of 17 fixtures passed every recent run. They are a
  regression suite now; they can't show improvement.
- **Long work is barely tested.** One long-horizon browser task; 6 of 22 live browser tasks ever
  ran, once each. The longest workflow runs are about 20 calls.
- **Workflow runs come from debugging passes, not a fixed suite.** Overall Haiku passed 43 of 136
  (32%), but the mix of tasks changed run to run, so that number is not a baseline.

### Failures by provisional cause (93 failed Haiku workflow runs)

| Cause | Runs (about) | What happened | Where |
|---|---|---|---|
| **P** perception | 27 | Pricing pages render with JavaScript, so `web.fetch` returned pages with no prices; LinkedIn answers 999 to anonymous fetches; some fetches came back empty. The run has no way to render a page without a visible screen, so the model cites third-party snippets or gives up | research-compare-pricing 0/18, read-linked-page, competitor-watch, icp-qualify, content-brief, outreach-drafts |
| **R** reasoning | 26 | Answers from search snippets without opening the page (often after one or two calls); lists items the person didn't ask for despite the scoped-answer rule; saves a workflow instead of running it; books a slot that wasn't free | video-members 4/19, inbox-triage 1/10, scheduled-digest, schedule-meeting |
| **H** harness | 19 | `screen_look` and `screen_open` end the run, so the task never finishes (ledger P3); the integration family wasn't loaded, so the agent said no email app was connected; "my calendar" went to Misty's calendar; the agent said it had no click tool instead of switching to browse | inventory-check, injection-research, board-triage, summarize-current-tab, cursor-do-it, outreach-drafts, schedule-meeting |
| **E** eval | 21 | Before October 16's fix the judge couldn't see tool results and failed correct work as unverified; drafts and events from earlier trials leaked into later ones; runs paused on the test account's usage limit; an approval card waited for a person the eval doesn't have; the judge called `web_fetch` "a browser" | most account-task failures on October 16, schedule-meeting, recruiting-followups, social-post-draft |

What this changes:

1. **The largest known failure is perception, not the model.** research-compare-pricing failed
   18 of 18, including tonight's runs with the new citation check and research budget (both
   uncommitted in this checkout). The guards changed what the agent said about its sources, not
   whether it could read the prices, because nothing in the run can render the page. Ledger R2
   (a hidden-tab reader for JavaScript pages) is the fix, and no prompt or model change replaces it.
2. **The second is the model taking the cheap path at `low` effort.** Snippet-only answers and
   one- or two-call runs fit what low effort does by design: fewer, shorter tool calls. This is
   the first thing the effort sweep should test, on these tasks.
3. **Hand-offs that end the run (P3) are a whole class of failure,** not an edge case: every
   screen task in the workflow suite hit it.
4. **About a fifth of failures were the eval, not the agent.** Trials need a clean account state
   (undo or reseed between trials, ledger E7), an eval plan without usage limits, and a stand-in
   that answers approval cards per task.
5. **Guards are piling up without moving the hardest task.** Finish check, citation check,
   research budget: each runs one refuse-and-retry turn (the doubled `agent_finish` in most of
   tonight's runs), and research-compare-pricing is still 0%.

### Bottlenecks already known, ranked

| # | Bottleneck | Evidence | Fix | Status |
|---|---|---|---|---|
| 1 | No way to read a JavaScript page without a visible screen | 0/18 pricing; empty fetches | Hidden-tab reader (R2), then background read of the current tab (R1) | Not built |
| 2 | Screen hand-offs end the run | Every screen task in the suite | `screen.look` / `screen.open` inside the run (P3) | Not built |
| 3 | Effort pinned at `low` | Snippet-only answers, early stops | Effort sweep, then the per-turn policy | Not measured |
| 4 | Eval state leaks between trials; usage limits and approvals in evals | Pre-existing drafts and events, paused runs, `needs_person` | Reseed or undo per trial, eval plan, approval stand-in | Partly built (undo exists) |
| 5 | Agent tabs get untrusted input; Google apps need a visible window | Browser README, live Google runs | Keep agent tabs painting (K2) | Not built |
| 6 | Cross-origin frames unread | `page_tree.js:108` | K1 | Not built; no task covers it yet |
| 7 | Tool list changes mid-run | `toolsets.ts`, research budget | Fixed list with refusals (H2) | Not measured |
| 8 | Browser suite never run on Haiku | All 196 runs on Luna | Re-run the 17 fixtures and the Google live tasks on Haiku | Cheap; do now |

### So: scan first, then benchmark

The scan was worth doing before benchmarking: it names three fixes (R2, P3, and clean eval
state) that the public benchmarks would only rediscover at a higher price. It can't replace them,
though: the local suites are saturated, short and self-written, so they can't say how far Misty
is from Comet and Polar or catch problems no one has written a task for yet. The path below
therefore starts with the known fixes and the cheap re-runs, and brings in the public suites
straight after.

## 7. The path

Each phase ships on its own and is judged by the suite. Costs assume Haiku 5.5 and are rough.

### Phase 0: fix what the runs already show (about a week)

| ID | Work | Done when |
|---|---|---|
| Z1 | Clean state per trial: undo or reseed mail, drafts, events and tasks before each trial; an eval plan without usage limits; a per-task stand-in that approves or declines approval cards | A task passes or fails the same way on trial 1 and trial 3 for the same agent output |
| Z2 | Re-run the 17 browser fixtures and the 5 Google live tasks on Haiku 5.5 at N=3 | Haiku browser baseline recorded in agentic-browser-results.md |
| Z3 | Hidden-tab reader for JavaScript pages (ledger R2), offered when `web.fetch` returns a page with little text or a block | research-compare-pricing passes on holdout trials |
| Z4 | Screen hand-offs inside the run (ledger P3) | Screen tasks finish in one run |
| Z5 | Effort sweep on the workflow suite only (cheap) | `HouseReasoning` chosen from data |

### Phase A: measurement you can trust (first two weeks)

| ID | Work | Done when |
|---|---|---|
| M1 | **Capability suite in Misty's browser.** Adapters that run BU Bench V1 (100) and a fixed 50-task Odysseys sample through the eval bridge, with their own graders. Split each into train and holdout once, frozen | Both run end to end in Misty's browser; first scores recorded next to the published ones |
| M2 | **Trials and statistics.** Every task N=3; report pass@1 with a 95% interval, pass^3 for write tasks, cost per completed task, turns, and cache share. A change counts only when its holdout interval clears the old one | Report shows intervals; ledger E1 extended |
| M3 | **Calibrated judge.** A judge model different from the agent (Sonnet 5.5 at `low`), one call per rubric item, an "unknown" verdict, state checks first. Label 50 runs by hand and keep the judge only at ≥90% agreement | Agreement recorded; judge model pinned |
| M4 | **Failure attribution.** The ablation ladder from section 3 on every failure, writing one label per run and a weekly table | First table committed in this doc |
| M5 | **Effort sweep.** `low` / `medium` / `high` across the capability and workflow suites | `HouseReasoning` set from the result |
| M6 | **Trace views for agents.** A CLI that prints a run at three depths (summary, turns, raw tool I/O) as TSV, from `log.run` | A coding agent can find a root cause without reading raw JSON |

Rough cost: a full capability pass at N=3 is a few hundred Haiku runs; at today's observed
$0.01–0.05 per short run and more for long Odysseys tasks, budget on the order of $20–60 per full
pass, plus the judge. Run it weekly, and run train-split subsets during development.

### Phase B: perception and action (driven by the P and A rows)

| ID | Work |
|---|---|
| K1 | Cross-origin frames: page runtime in every frame, stitched snapshot with frame-prefixed refs, actions routed to the frame (macOS first, then WebView2 and WebKitGTK) |
| K2 | Agent tabs that keep painting: off-screen composited windows so native input and screenshots work in the agent's own and sub-agents' tabs |
| K3 | Screenshot with the snapshot when the page is visual (canvas, maps, charts) or a text action just failed, with refs drawn on the image (set-of-marks) |
| K4 | Spike: the engine accessibility tree through macOS accessibility for the app's own WKWebView |
| R1, R2 | From the ledger: read the current tab in the background, and a hidden-tab reader for JavaScript-only pages |

### Phase C: harness (driven by the R and H rows)

| ID | Work |
|---|---|
| H1 | The reasoning policy in section 5, behind a flag, compared with the M5 winner |
| H2 | A fixed tool list for the whole run. Disallowed tools return a short refusal naming the allowed route instead of disappearing; `agent.tool.use` stays as the routing decision. Measure cache share before and after |
| H3 | A verification turn before finishing, at higher effort, that checks the answer against the request and the evidence it read. Retire the refuse-once guards the holdout no longer needs |
| H4 | `log.work` as recitation: the plan is rewritten and re-read every N turns and after compaction |
| H5 | Tool-shape A/B (section 5) and sandboxed code for extraction |
| H6 | Long-horizon checks: sub-agents and the notebook measured on Odysseys tasks, not only fixtures |

### Phase D: a loop that improves the agent

| ID | Work |
|---|---|
| L1 | **Auto-research.** Claude Code sessions with the eval CLI and M6's trace views, each given one target row from the attribution table, 10–20 cycles each, told to make large changes, working on the train split under an AI Gateway spend cap. A change merges only when it improves the holdout without dropping any category. Task-specific fixes are rejected at review |
| L2 | **Workflow memory** (ledger W1–W4), measured by cold and warm runs (E4) |
| L3 | **Real failures into the suite.** With the person's consent, a failed or stopped production run can be turned into a regression task (prompt, start page, expected outcome), as Anthropic's guidance recommends |
| L4 | **Production signals.** Stops, takeovers, retries and "Not finished" rates per category, as the outcome measure once there is traffic |

### Phase E: the model layer (only when the numbers call for it)

| ID | Work |
|---|---|
| X1 | Advisor experiment: Haiku executor with Sonnet 5.5 or Opus 5.5 as advisor on planning and verification turns, `max_uses` 2–3, against the H1 policy; keep only if cost per completed task falls or holds |
| X2 | Open-weight navigator: only after L1–L4 have produced enough graded trajectories and the cheaper levers have stopped moving the holdout |

### Order

Z1–Z5 → M1–M6 → the top two rows of the first attribution table (expected from K1, K2, H1 or H2) →
L1 running continuously → the rest as the table ranks them.

## 8. What not to do

- Don't add another refuse-once guard or family note for a single failing task; put the task in
  the suite and let the attribution table rank it.
- Don't compare models by running each once; three trials per task is the floor.
- Don't let the agent's model grade itself.
- Don't remove tools mid-run to steer the model.
- Don't move to Chromium to close the automation gap; the gaps that matter (frames, hidden-tab
  input and capture, the accessibility tree) have WebKit-side routes worth spiking first, and the
  owner has ruled Chromium out.

## Sources

- Comet internals †: Zenity Labs, [Perplexity Comet: A Reversing Story](https://labs.zenity.io/post/perplexity-comet-a-reversing-story)
- Polar: [Introducing Polar](https://polarbrowser.com/blog/introducing-polar), [Frontier Problems](https://polarbrowser.com/blog/frontier-problems), [What Is an AI Browser?](https://polarbrowser.com/blog/what-is-an-ai-browser), [polar-evals](https://github.com/recursive-hq/polar-evals); [TechRepublic](https://www.techrepublic.com/article/news-polar-ai-browser-security/) †; design replication [sippycoder/agentic-browser](https://github.com/sippycoder/agentic-browser) †
- Browser Use: [How we built the best browser agent with Auto-Research](https://browser-use.com/posts/online-mind2web-benchmark), [BU Bench](https://browser-use.com/posts/ai-browser-agent-benchmark)
- Benchmarks: [Odysseys paper](https://arxiv.org/abs/2604.24964) and [site](https://odysseysbench.com/), [BU Bench V1](https://browser-use.com/posts/ai-browser-agent-benchmark), [aside-benchmarks](https://github.com/at-inc/aside-benchmarks) †, [Steel leaderboard](https://leaderboard.steel.dev/) †
- Anthropic: [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), [prompt injection defenses](https://www.anthropic.com/research/prompt-injection-defenses), [Claude in Chrome safety](https://support.claude.com/en/articles/12902428-using-claude-in-chrome-safely), [Claude Haiku 5.5 on Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html)
- Manus: [Context Engineering for AI Agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- OpenAI: [Building ChatGPT Atlas](https://openai.com/index/building-chatgpt-atlas)
- GEPA: [Reflective Prompt Evolution Can Outperform Reinforcement Learning](https://proceedings.iclr.cc/paper_files/paper/2026/hash/0e9e708b6f48e14fd0ac29e167413f76-Abstract-Conference.html)
- Fine-tuning availability †: [Top fine-tuning platforms 2026](https://guptadeepak.com/tools/top-8-fine-tuning-model-customization-platforms-2026/), [Claude 3 Haiku fine-tuning](https://www.anthropic.com/news/fine-tune-claude-3-haiku-ga)
- WebKit device APIs †: [Safari declines WebUSB and others](https://usefulangle.com/web-updates/post/78/safari-decines-to-implement-web-usb-api)
