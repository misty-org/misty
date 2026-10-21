# Agent harness v2: what the Odysseys results say, and what changes

October 19. After 20 batches the harness is reliable but not accurate. Across 116 graded runs of
the 10 dev tasks, 619 of 844 rubric items failed (73%). The best batch (15) scored 3/7 perfect;
batches 17–19 scored 1/10, 0/6 and 0/10. This plan covers the patterns behind the failures, how
other harnesses are built, and the changes, in order. No more batches until the changes are in.
Then there is one controlled comparison.

## What fails

Each rubric item's pass rate across all runs, read with the judge's reasons:

| Pattern | Examples (pass rate) | What the agent did |
|---|---|---|
| **Proof tabs missing** | Shopping extensions R6, 0/17; three pediatrician items, 0/22 | Read pages with `web_fetch` or closed tabs; left a tab on a generic page or behind a modal, not in the state asked for |
| **Interaction never done** | Aetna, UHC and Blue Cross pediatrician searches, 0/22; ALS product page, 0/23; PLT size 12, 3/23 | Never filled the directory's search form, never clicked from search results into a product, never picked a size |
| **Breadth not reached** | 10 pediatricians (2/22), 10 daycares (2/22), 12 hotels, 20 medical schools (0/13) | Ran out of time or turns at 5–7 items; one item at a time, many steps each |
| **Web-app documents** | CryptPad items, 0/17 and 0/13 | The editor stayed empty or the drive never loaded |
| **Gave up on a changed source** | U.S. News items, 0/13 | U.S. News no longer ranks numerically; the agent stopped instead of using its tiers plus a second source |
| **Infrastructure** | "AI usage limit", "device offline" runs | Not the agent: account limits and device hand-offs, all since fixed |

The tool mix over all runs: 1,033 page openings and 942 off-screen fetches, against 139
`browser_steps` (the clicking and typing tool). The agent reads; it rarely acts.

## How the loop performs

Measured on the last 12 hours of runs:

- **Model turn:** 9.4 s median, 18.5 s p90.
- **Context per turn:** 35,000 input tokens median, 100,000 p90. Every snapshot, extract and fetch
  stays in the conversation, so each turn rereads the whole history.
- **Tool call:** 10.9 s median, 30.8 s p90. On the device most operations take 0.2–3 s and start
  0.3–2.3 s after they're queued. Opening a page takes 12.9 s median against 1.7 s on the device,
  and navigating 10 s against 2.9 s, so the remaining 6–9 s is in the server's handling around
  the device job.
- So a step costs about 20 s, and a 30-step task takes 10 minutes before it does anything wrong.

## How other harnesses do it

**browser-use**, open source and widely benchmarked:

- **One step is one model call.** It sees the current state, pushed by the harness:
  - URL and tabs;
  - interactive elements as an indexed tree, with elements new since the last step marked `*`;
  - scrollable containers and shadow DOM flagged;
  - optionally a screenshot with numbered boxes.
- **It answers in JSON:** `evaluation_previous_goal`, `memory` (1–3 sentences), `next_goal`, then
  a list of actions run in order. The list stops if the page changes.
- **History is compact:** each past step keeps only its evaluation, memory, goal and action
  results; old page states are dropped.
- **Its rules:**
  - popups first;
  - autocomplete: type, wait, pick a suggestion;
  - apply filters before browsing;
  - break loops after 3 steps on one URL without progress;
  - at 75% of the budget, consolidate;
  - verify every requirement before `done`.
- **A todo file and a results file** hold progress on long tasks.

**Aside** (75.5% on Odysseys with GPT-5.5) used up to 200 steps, a 30-minute limit and six tasks
at once. Its harness isn't published.

**Other patterns:**
- Stagehand: act, extract and observe over the accessibility tree.
- Agent-E: a planner over a navigator, with a distilled DOM.
- WebVoyager and OpenAI's CUA: screenshots with marks, and pixel actions.

All of them run the browser in the agent's process, so a page action costs well under a second.

## How we differ

| | browser-use | Misty today |
|---|---|---|
| Page state | Pushed every step, current only | The agent asks for it (`browser_snapshot`), and every copy stays in history |
| Per-step reasoning | Required: evaluation, memory, next goal | Free text; progress lives in the checklist |
| History | Compact notes | Full transcript, condensed late |
| Actions | One schema of about 15 actions, several per step | 25+ overlapping tools (`screen_open`, `browser_navigate`, `browser_tab_open`, `web_fetch`, `browser_extract`, `browser_find`, `browser_snapshot`, `browser_visual`, `browser_inspect`, `browser_act`, …) |
| Input | Real typing, autocomplete flow | `fill` sets values; hover and scroll by script |
| Loop guard | 3 steps without progress | Research budget and turn deadline only |
| Breadth | Todo and results files | Checklist; sub-agents exist but are rarely used |
| Action cost | Under 1 s | About 11 s |

## Changes, in order

### 1. The loop and its context (model side)

- **Pushed page state.** After every browser action, the result carries the tab's compact state:
  URL, title, open tabs, and interactive elements with refs, new ones marked. The agent stops
  calling `browser_snapshot` just to look. Only the latest state stays in full; older states and
  older tool outputs collapse to one line each.
- **Progress notes.** Each turn opens with three short lines before its tool calls: the last step
  worked or didn't, what's known so far (counts, findings), the next goal. Collapsed history
  keeps these lines.
- **Loop guard.** Three turns on the same URL with no new findings, or the same failing action
  twice, prompt a change of approach.
- **Target:** median context under 15,000 tokens; model turn under 5 s.

### 2. Proof and completion

- **Kept tabs.** A tab the task asks to keep (as proof, to compare, to review) is marked `keep`.
  `screen_close` won't close it, and it's left showing the evidence: scrolled to it, overlays
  closed, filters applied.
- **Final review.** Before finishing, the run lists its tabs (title, URL, what each shows) against
  the requirements ledger, and reopens or fixes any missing proof.

### 3. Acting like a person

- Real hover, wheel scrolling and key-by-key typing (docs/design/agent-actions/BRIEF.md, step 1).
- Form rules, as browser-use has them:
  - autocomplete: type, wait, pick;
  - submit or press Enter;
  - choose options such as size or date;
  - apply filters before browsing results.
- Search results are clicked through to the item, not guessed at by URL.

### 4. Breadth

- A task with several similar items (10 pediatricians, 20 schools) is split across sub-agents.
  Each gets its own agent window and tabs and returns structured rows; the parent merges them.
- A results file holds rows as they're found, so a run ending early still reports them.

### 5. Speed

- Cut the 6–9 s the server adds to opening and navigating a page. Profile the handlers: grant
  verification, context attachment, and catalog reload after `catalog_changed`.
- Find the occasional stalls in the person's window (claim to begin up to 52 s).

### 6. One tool surface

Fold the overlapping page tools into fewer, clearer ones:
- `browser_open` (a tab, with `keep`);
- `browser_steps` (every action);
- `browser_read` (state, find, extract);
- `browser_tabs`.

Drop or hide the rest for runs with their own window.

## Findings while building (October 19)

- **Fixed cost per turn.** The first turn carried 65 tools (46,000 characters) and a 16,000-character
  system prompt, so even a short transcript cost about 22,000 input tokens. Misty's own data tools
  (notes, drawings, memory, workflows, messages, Spaces) are now a deferred family, loaded with
  `agent_tool_load` or up front when the request is about the person's own things (17 of 200
  Odysseys prompts). The first turn went from about 22,000 to 10,700 tokens.
- **Prompt cache.** The working set cut one old result almost every turn once a run passed 24,000
  tokens, and each cut rewrote earlier messages, so every later turn was uncached (a live run read
  0 cached tokens from its third turn on). Cuts now wait until they save about 10,000 tokens, and
  the end of the previous request carries a second cache breakpoint, so a turn with many parallel
  calls still finds its cache. Each condenser that changes the transcript is logged (`condensed`).
- **What the agent sees.** A snapshot was the page in document order, cut at its size limit; on
  most sites the header and its menus came first and used the budget, so the content, search box
  and filters were cut off. That explains repeated snapshots and few clicks: runs scoring 0.75 or
  more acted on a page 3.1 times on average, runs under 0.5 only 1.3 times, against 20 to 30
  reads. When a page doesn't fit, each menu (navigation, banner, footer, sidebar) now gets a small
  share and says how many items it left out; the rest goes to the content. The page state pushed
  after opening a tab is 12,000 characters, the same as after steps.
- **How runs end.** 73 runs called `agent_finish` and still ended failed, because the agent reported
  them partial; only 11 of 125 ended completed. 31 more answered in plain text after working and
  ended unreported (shown as failed), one of them with a perfect answer. Such a run is now asked
  once to confirm with `agent_finish`, and every finish is logged (`run_finish`: outcome and the
  requirements left).
- **A lost first page.** A run's first `screen_open` waited 30 s and failed. The job had been
  claimed by a worker in another window: the host hand-off event reached every window, so agent
  windows ran workers too, and one closing dropped the job it held. Windows now ask whether they
  are the host when the event arrives, and a claim that returns after its worker stopped is put
  back (`/workflow-node-jobs/{id}/release`) instead of dropped.
- **Breadth and giving up.** Every pass-A run called `agent_finish` 4 to 7 times; the model declares
  itself done at a third to a half of the work. `agent_delegate` was behind a load and never used;
  it is now offered to every run with its own tabs, and its children's tabs open in the parent's
  agent window. The prompt asks for several similar items per turn (a run went from 73 to 118 tools
  in the same time), the research budget no longer says "Answer now" to such runs, and give-ups are
  sent back up to eight times while a run is under 80% of its own estimate.
- **The device slowed down.** 250 WebKit page processes for 54 open pages: destroying an agent
  window left its pages' processes behind, and each run made the next slower (pass B's
  `screen_open` p90 was 41 s). Agent windows now close their pages one by one first, yet about eight processes per run still
  remain; the holder is not found yet.
- **An answer replaced.** A run whose click ended "uncertain" had its whole answer replaced by
  "Some actions have not been confirmed"; the answer now stays, with the warning after it.
- **Popups and scrolling.** The agent read pages as text, so it never scrolled (a snapshot holds
  the whole page) and never noticed popups (one read like any other text). Now popups that open with
  a page are closed with their own close control after load (never a sign-up, subscribe or accept
  control), a popup still covering the page leads the snapshot with its close ref, and
  `browser_find` scrolls what it finds into view, so the page on screen shows the evidence.
- **Memory.** Closed tabs and closed agent windows left their WebKit page processes running (the
  app reached 16 GB in one 8-minute run). Pages and window views are now closed with WebKit's own
  page close before they go; after a run the app returns to its idle footprint (about 650 MB).
  Heavy sites still cost 400 to 600 MB a page while open; a memory budget is next.
- **Batch open dropped.** Several `screen_open` calls in one turn already run in parallel on the
  server; earlier latency came from serialized opens on the device.

## How we'll know

One controlled comparison at the end: the same 10 dev tasks, twice each, against batch 17's
scores, reporting perfect rate, rubric average, steps, time, and context per turn. Each change
also gets its own unit tests and a live check on one task, not a batch.
