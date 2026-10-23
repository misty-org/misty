# Odysseys campaign

The goal, rules and loop for improving Misty's agent against Odysseys, the long-horizon web
benchmark other AI browsers report on. Written October 17, 2026. The harness it measures is
[agent-harness.md](../harness.md).

## Goal

Pass as much of Odysseys as possible, accurately and fast, on Misty's house model (Haiku 5.5),
by fixing the architecture rather than the model. If the product works well on a small model, it
will work better on a larger one.

| Measure | Reference | Milestones |
|---|---|---|
| Perfect tasks (every rubric item passes) | Paper's best 44.5% (Opus 4.6, 100 steps); aside GPT-5.5 high 75.5% (200 steps); Polar 98% (self-reported) | A: above 44.5% · B: above 75.5% · C: 90% · stretch: 98% |
| Rubric average | Polar 0.996 | ≥ 0.97 at milestone C |
| Steps | Each task's `reference_length` (a person's step count) | Median ≤ 2× reference length |
| Wall time per task | Not published by anyone | Measure at the first pass, then halve the median by milestone C |
| Step budget | Paper 100 | 100 model turns, as the paper allows |

Headline numbers use the official judge script unchanged (`run_full_trajectory_per_rubric.py`,
Gemini 3.1 Flash-Lite, per-rubric, from step screenshots and actions). A second judge that also
reads Misty's text evidence (fetched pages, extracted data) is reported alongside, because the
official judge only sees screenshots.

## Rules

1. **Fix what is known before benchmarking.** Everything in "Before the first benchmark" lands
   first.
2. **Stop early when failures pile up.** Tasks run in batches of 10. A batch stops when 4 of its
   first 6 finished tasks fail, or when one failure cause appears 3 times. Then attribute, fix,
   and re-run the failed tasks before going on.
3. **Fix causes, not tasks.** Every fix must make sense for a task Misty has never seen. No
   site names or task wording in prompts or code. Architecture swaps are allowed.
4. **Regression gate.** Before any batch resumes: the 17 browser fixtures and the workflow suite
   must not get worse.
5. **Holdout stays untouched.** Development uses the dev split only. The holdout runs at
   milestones; the rest of the 200 only in full passes.
6. **Safe on the live web.** The eval uses its own Misty browser profile with no sign-ins. Pay,
   send, post, delete and sign-up are refused, never auto-approved. Tasks that need an account
   are flagged and reported apart, not faked.
7. **Spend stays under the $50 cap**, metered by the eval from token usage (see Decisions).
8. **No Chromium, no cloud browsers.** Everything runs in Misty's own browser.

## Data and splits

Tasks: [ljang0/Odysseys](https://github.com/ljang0/Odysseys) `data/odysseys.json` (MIT): 200
tasks (45 easy, 46 medium, 109 hard), each with a prompt, a Google start page, a reference step
count and 3–12 rubric items. The split is fixed once, stratified by level:

| Split | Tasks | Used for |
|---|---|---|
| Dev | 40 (9 easy, 9 medium, 22 hard) | Every iteration |
| Holdout | 60 | Milestones only |
| Rest | 100 | Full passes only |

## Before the first benchmark

| ID | Work | Why |
|---|---|---|
| F1 | A campaign worktree and branch; the dev stack and the desktop app in debug mode with the eval bridge, run from it | The main checkout has other sessions' uncommitted work |
| F2 | Clean state per trial, an eval plan without usage-limit pauses, an approval stand-in (review §6: a fifth of failures were the eval) | Numbers that repeat |
| F3 | **Odysseys adapter** in `server/apps/agent-runtime/evals/odysseys/`: each task runs as a real composer request through the product path (the agent's own tab, starting at Google), with a 100-turn limit; it writes `steps.jsonl` with a screenshot and the action for every step, then runs the official judge and Misty's text-evidence judge | Measure the product, not a test rig |
| F4 | **The whole website for the model:** a rendered-page reader for JavaScript pages (review Z3); page text that includes lazy and below-the-fold content; every frame, cross-origin included (K1); open shadow roots and PDFs; a screenshot beside the snapshot when the page is visual or a text action failed (K3) | The user's first priority, and the largest known failure |
| F5 | **Agent tabs keep painting** (K2) so trusted input and screenshots work in the agent's own and sub-agents' tabs | The official judge needs screenshots of every step; sites ignore untrusted clicks |
| F6 | Screen hand-offs wait inside the run (ledger P3) | Every screen task in the workflow suite failed on this |
| F7 | Haiku baseline on the browser fixtures (review Z2), and an effort sweep on the workflow suite (Z5) | The regression gate, and the starting effort |

## The loop

```
pick the next dev batch (10 tasks)
  → run, 4 at a time, with the early-stop rule
  → attribute every failure: P perception, A action, R reasoning, H harness, E eval
       (ablation on failures only: oracle screenshot + full text; higher effort)
  → fix the top cause, at the architecture level
  → re-run the failed tasks, then the regression gate
  → log the iteration below
every 3 iterations, or after a 10-point gain: holdout
at each milestone: full 200, then one run at higher effort to check the "bigger model does better" claim
```

Harness changes waiting for evidence, pulled in when attribution points at them:

| Candidate | Expected to fix |
|---|---|
| Effort chosen per turn (plan high, navigate low, verify high) | Early stops, snippet-only answers |
| Planner with a rewritten checklist (`log.work`) re-read every few turns | Drifting off the goal on long tasks |
| Sub-agents for fan-out (one per site or item), the parent merging | The paper's "visit all 30 stadiums" failure |
| A deliverable deadline: a task budget, and a forced write-up before the turn limit | The paper's "keeps researching, never delivers" failure |
| Verification turn before finishing, replacing the refuse-once guards | Wrong or partial answers marked done |
| Fixed tool list, with refusals instead of removals | Cache misses and confusion after tool switches |
| Tool shapes closer to Claude in Chrome's; sandboxed code for extraction | Mis-chosen actions, bulk extraction |

## Cost and time (rough)

| Step | Agent | Judge | Per batch or pass |
|---|---|---|---|
| One task, one trial | $0.05–0.15 (Haiku, about 40 turns, mostly cached) | about $0.05–0.10 (Flash-Lite with screenshots) | — |
| Dev batch of 10 | | | about $1–3, 20–40 minutes |
| Full 200 | | | about $30–50, 5–8 hours at 4 at a time |

A full campaign to milestone C is likely about 15–25 dev batches, 4–6 holdout runs and 2–3 full
passes: on the order of $100–200.

## Decisions (October 17, 2026)

- **Budget: $50 for the whole campaign**, on Misty's own Anthropic API key (about $100 of free
  credit), not the AI Gateway. The agent runs on Haiku 5.5 through the runtime's direct Anthropic
  route. The eval meters spend itself from token usage at Anthropic's prices, since the Gateway
  balance no longer sees it. The official judge (Gemini 3.1 Flash-Lite) is the only Gateway
  spend, a few cents a task, within the remaining Gateway balance.
- At $50 the plan is: dev batches first (about $1–3 each), the holdout at milestones, and one
  full 200-task pass when the dev split justifies it. More full passes need a higher cap.
- **Profile:** a fresh Misty browser profile with no sign-ins.
- **Git:** all earlier work was committed to `main` and pushed (`4fd0a3c1`); every other local
  branch and linked worktree was removed (all merged except a Spaces spike with no UI changes).
  The campaign works on the `odysseys-campaign` branch in the main checkout, where the dev stack's
  env files, sign-in file and build caches live, and commits there. Nothing is pushed or merged
  without asking.
- **Apps:** the campaign starts and restarts the dev stack and the desktop debug app itself.
- **Known failing suites at the start** (inherited, in the commit messages): frontend
  typecheck, lint and unit; server-go `TestEnvironmentContractIsExplicit`; desktop crate
  (`misty::CurrentUser` has no field `name`). The desktop one blocks building the app, so it is
  fixed first.

## Reporting

This file holds the iteration log. Each fix is one commit on the campaign branch, with its batch
results in the message.

| # | Date | Change | Dev perfect | Dev rubric avg | Holdout | Median steps / time | Spend |
|---|---|---|---|---|---|---|---|
| 0 | Oct 17 | Setup and the fixes below; one smoke task | 0/1 | 0.00 | — | 13 calls / 130 s | $0.11 |
| 1 | Oct 18 | First dev batch, `medium` | 0/6, stopped early | 0.00 | — | 14 calls / 60 s | $0.14 |
| 2 | Oct 18 | Budget scaling, persistence check, turn-limit fix, Ultra+ eval plan | 0/3, stopped by hand | 0.18 | — | 40 calls / 231 s | $0.25 |
| 3 | Oct 18 | Several own tabs, extraction fixed (still 20 turns) | 0/2, stopped by hand | 0.00 | — | 24 calls / 128 s | $0.12 |
| 4 | Oct 18 | 90 turns (eval_turn_limit), long-lived background leases | 0/3, stopped by hand | 0.38 | — | 43 calls / 149 s | $0.34 |
| 5 | Oct 18 | Allowance per checklist step, 16 tabs, 60-image judge | 0/2, stopped by hand | 0.42 | — | 56 calls / 294 s | $0.34 |
| 6 | Oct 18 | Websites count as tools, background grading | 0/2, stopped by hand | 0.75 on the shopping task | — | 62 calls / 388 s | $0.21 |
| 7 | Oct 18 | Stopping a pass cancels its run; 32k output; screen-model calls out of the billing aggregate | 0/2, stopped by hand | 0.07 | — | 45 calls / 523 s | $0.31 |
| 8 | Oct 18 | Dev tasks 6–10, `medium` | 0/5 | 0.43 | — | 49 calls / 354 s | $0.56 |
| 9 | Oct 18 | K1 read (frames), parked agent tabs, evidence guidance, recorder fix | 0/3, stopped by hand | 0.30 | — | 54 calls / 341 s | $0.63 |
| 10 | Oct 18 | Requirements review, K1 actions (frame refs, CryptPad), 32 tabs, three refusals | 0/2, stopped by hand | 0.06 | — | 38 calls / 171 s | $0.25 |
| 11 | Oct 18 | Own-tab failures planned around, plain answers checked, summary is the whole answer, tabs reused | 0/7, stopped early | 0.24 (0.34 without two connect failures) | — | 72 calls / 508 s | $1.17 |
| 12 | Oct 18 | Consent decline, parallel calls | 0/4, stopped by hand | 0.21 (network failures) | — | 91 calls / 659 s | $0.65 |
| 13 | Oct 18 | IPv4-first provider calls, commit to picks, whole final answer to the judge | 0/2 before the account ran out of AI usage | 0.43 | — | 76 calls / 479 s | $0.47 |
| 14 | Oct 18 | Requirements ledger at the start | 0/2, stopped by hand (tabs idled out) | 0.43 | — | 81 calls / 599 s | $0.52 |
| 15 | Oct 18 | Sessions kept alive by any tab, research scaled by the ledger, clean app restart | **3/7** (two hard, one medium) | **0.67** | — | 90 calls / 730 s | $1.85 |
| 16 | Oct 18 | screen_close, covered layers hidden | 0/3, stopped by hand | 0.38 | — | 82 calls / 623 s | $0.74 |

### Fixes before the first batch (October 17)

Found while getting one task to run end to end, in the order they blocked it:

1. **The agent's own tab joins the run** (`0fd49407`). `screen_open` used to end the run and hand off
   to a new one that re-planned; the eval could not follow it, and in the product one task became
   several runs. Now, with no place named, a device opens the agent's own hidden tab as a job, the
   tab is attached to the running task, and the runtime reads the catalog again so browser tools
   appear from the next turn. Hidden sessions take background leases (no more `agent_busy` for a
   second request), and an uncertain, non-consequential click is looked at again instead of ending
   the run.
2. **Every browsing run failed on the direct Anthropic route**: `browser.upload`'s schema had a
   top-level `oneOf`, which Anthropic refuses. The runtime now drops top-level combinators.
3. **The model never learned the browser tools** when its tab joined mid-run, since the prompt is
   written at the start. Runs that can open their own tab now get the browser guidance up front.
4. **Navigation was blind** (`f98eab92`): `browser_navigate` returned only `{ok, url}`. It now waits
   for the page and returns its snapshot. Weak `browser_find` matches say so.
5. **The research budget pushed the agent to answer** at exactly the point it should have opened a
   page; its note now names `screen_open` for facts behind toggles and JavaScript.
6. **Guessed URLs** (`0c4bbf0a`): guidance to find pages by searching instead.
7. **Eval infrastructure**: the dev stack ran GPT-6 Luna, not Haiku; the CLI refused the Anthropic
   key; agent tabs used the owner's signed-in profile (now a throwaway session); the bridge could
   not picture agent tabs; the Docker disk filled with build cache and failed every request.

### Batches 1 and 2 (October 18)

Every failure was the harness, not the model. In order found:

| Cause | Label | Fix |
|---|---|---|
| `screen_open` called once per site in one turn raced for the one session tab; all but one failed | H | Later calls find the tab attached; calls take turns per run (`cfc3caca`, `0d1b4b32`) |
| `browser_extract` always failed: browser tools ran on a bare service without the model client | H | Toolboxes pass the real service (`cfc3caca`) |
| Once extraction worked, every run that used it failed at completion with a billing conflict: completion subtracted the extraction's tokens from the runtime's aggregate | H | Server-side model calls stay out of the aggregate (`0d1b4b32`, with a test) |
| The research budget closed search and reading after 12 lookups on ten-part tasks | H | The budget scales with the run's checklist (`65665bd8`) |
| Runs reported "partial" after one or two minutes with most turns unused | R/H | A partial finish is refused once while less than half the turns are used, unless the rest needs the person (`65665bd8`) |
| Pro runs get 20 turns; a run hit the limit mid-browse and ended with no answer at all | H/E | The eval account runs on Ultra+ (90 turns) during passes; two turns before any limit the run must write its answer (`bfb50002`) |
| Tasks ask for pages "kept open in tabs"; the agent had one tab and said so, failing those rubric items | H | `screen_open` opens more tabs of the agent's own (up to 8) (`0d1b4b32`) |
| Docker's disk filled with build cache; the database refused writes | E | Prune build cache after rebuilds |

### Batches 3 to 6 (October 18)

| Cause | Label | Fix |
|---|---|---|
| The agent's own tabs died mid-task (`native_lease_expired`): their 30 s lease is renewed by a timer in the app window, which WebKit throttles in the background | H | Background leases last 10 minutes (`3cc1426b`) |
| Edited billing tiers were reverted by reconciliation, so runs kept 20 turns | E | `eval_turn_limit`, honored only in development with model override (`3cc1426b`) |
| The research budget said "answer now" at turn 11 of 90; eight tabs filled up | H | One base allowance per checklist step; 16 tabs, navigate a tab for pages only read (`0727262a`) |
| The judge saw only the last 24 screenshots, missing pages read early | E | 60 screenshots (`0727262a`) |
| The agent said no tool could create a CryptPad document | R/H | Guidance: websites are tools (`d3d2c3d3`) |
| One refusal of an early give-up was not enough (4 of 10 pediatricians at turn 13) | R/H | A second refusal after more work (`d8fc661c`) |
| `screen_open` with `new_tab` took the old hand-off and ended the run | H | `new_tab` and `window` open the agent's own tabs in the run (`2344b0bb`) |

### Batches 7 and 8 (October 18)

| Cause | Label | Fix |
|---|---|---|
| Stopping a pass left its run going, spending | E | The runner cancels the run in progress (`1933f8ae`); in the vitest worker the signal does not arrive, so a helper script cancels |
| A long final memo hit the model's output limit and the run ended with no answer | H | 32k output tokens a turn (`3150e248`) |
| Runs whose agent used the screen model failed at completion with a billing conflict | H | Screen-model calls stay out of the runtime's aggregate, like extraction (`3150e248`) |
| Tool calls failed with a generic message and nothing in the logs | E | The API logs the cause (`587923bb`) |
| The agent asked a clarifying question and stopped (task `adc644f33f`, 0 of 7) | R/H | Assume sensible defaults and say which (`adeef2d6`) |
| After one uncertain click every later call failed: "the run has an unconfirmed effect" | H | Page actions that can't pay, send or delete are looked at again instead of gating the run (`2b3a00e1`) |
| Tabs left open by earlier tasks were pictured in later ones: up to 140 screenshots a task, the judge seeing only the last 60 | E | The recorder pictures only pages opened during the run (`c33f0c1f`) |
| Evidence the task asks to keep open was only fetched, so no tab showed it (R1 of `4614aa0831`, R6 of `42e2344431`) | H | Guidance: those pages are part of the answer, open in tabs and scrolled to the evidence; `scroll into_view` takes text (`7baaa051`) |
| A studio's class schedule is a cross-origin widget: snapshots, find and extract saw an empty iframe, and in a hidden tab it never drew at all (R2 of `5e09c06aa9`) | K | K1: frames announce themselves from a private content world and the page layer reads inside them; agent tabs are parked instead of hidden so they keep rendering (`7baaa051`) |

### Batch 9 (October 18)

Three hard and medium dev tasks scored 0.50, 0.11 and 0.29, and each finished with most of its turns
unused. The causes were already clear, so the batch stopped there:

| Cause | Label | Fix |
|---|---|---|
| Answers that read well skipped requested fields, items and pages (in-stock size, per-extension review links, the ALS product page) | H | A long request's draft answer is checked against it once by the run's own model; a run with turns left goes back to fill the gaps (`9e93eda8`) |
| A task asked for about 26 pages kept open; agents could hold 16 | H | 32 tabs (`8da813cc`) |
| Runs still reported partial with half their turns left after two refusals | H | Up to three refusals, each after more work (`8da813cc`) |
| CryptPad's editor lives in a cross-origin sandbox frame, so the document stayed empty (R7 of `d03a08650b`, R4 of `48a6cb73b8`) | K | K1 actions: frame refs come from per-frame ranges and steps, forms and skills run in their frame; editor frames get the editor skill. Checked by hand: a formatted CryptPad pad written and saved (`40205697`) |

### Batches 10 and 11 (October 18)

Runs now use their turns (50 to 68 of 90, ten to twelve minutes each) instead of giving up at a
third of them. What still failed:

| Cause | Label | Fix |
|---|---|---|
| The device was slow to answer one of 32 `screen_open` calls; the job was canceled at its deadline and the run ended at 41 s | H | An own tab that did not open is planned around, twice at most (`347c2f41`) |
| After a refused finish, the model answered in plain text and the loop took it (six of ten pediatricians, 27 of 90 turns) | H | Plain answers get the review, and one that skips what the last refusal listed goes back to work (`cd76e319`) |
| Two runs failed at their first model call with "Cannot connect to API", each right after another run ended | E/H | Model calls back off for about 30 s, and direct provider calls log the network error (`13523835`); the runner retries a run that never reached the agent |
| A stopped batch's vitest worker kept starting tasks beside the next batch | E | The stop script kills the worker too |
| A final answer pointed to a table "in my answer" above, which nobody sees | H | The finish summary is the whole answer (`eb705e90`) |
| Duplicate tabs of one listing crowded the requested set | H | A page opened again reuses its tab (`eb705e90`) |
| A tab opened early as proof fell outside the judge's last 60 pictures | E | Every open tab is pictured again at the end |
| Cookie banners covered evidence (Depop, UHC, a scholarship page) | K | Agent tabs decline consent banners the private way before reading, open shadow roots included (`a6d2e41c`) |
| A twelve-hotel run made one call a turn and covered six hotels | H | Independent calls go in one response (`90f6235b`) |

CryptPad works end to end now: in batch 11 the agent created a titled document and wrote into it.

### Batches 12 and 13 (October 18)

The shopping task reached 0.63 (its best) and the pediatrician task 0.44, but both batches were
spoiled by the environment more than the agent:

| Cause | Label | Fix |
|---|---|---|
| Model calls failed in bursts with ETIMEDOUT about 1.3 s apart, whole runs dying before their first step: Node raced IPv4 and IPv6 with 250 ms for IPv4, and the container cannot route IPv6 | E | IPv4 first, no family racing (`26640e9d`) |
| The judge saw final answers cut at 6,000 characters, so long reports' last sections were graded missing | E | The whole answer (`f6c923d1`) |
| The eval account spent its weekly AI allowance (14.25M units) mid-batch; the next six tasks failed in a second each | E | The local allowance is raised for the campaign (old row in the scratchpad restore notes; the weekly reset restores the plan's), and a pass stops when the account is out of usage |
| A run refused to pick ("Dress: unresolved") and left a popup over its evidence | H | Commit to a pick and say what is unconfirmed; close overlays over evidence (`3a096f68`) |

### Batches 14 and 15 (October 18): the first perfect tasks

| Cause | Label | Fix |
|---|---|---|
| Fields per item, review links and pages to keep open were found missing only at the end, with too few turns left | H | A requirements ledger: one short call lists the request's explicit requirements as the run's first note (`0cfb22db`) |
| A run working in its other tabs idled its session out after ten minutes and lost every tab ("the browser stopped responding") | H | Jobs on any of a session's tabs keep it in use (`cd39d759`) |
| A 26-page task ran out of search at a third of its turns | H | The research budget scales with the ledger, up to twenty base allowances (`cd39d759`) |
| A hot reload during a batch orphaned session timers | E | Restart the desktop app before a batch after frontend edits |
| Requested tab sets were crowded by sign-in pages and duplicates | H | `screen_close` closes a run's own extra tabs (`11d2b7af`) |
| CryptPad's drive looked stuck on "Loading..." (a placeholder at a negative z-index under the app frame) and a run gave up on the document | K | Covered layers behind the page are hidden from the tree (`97309ea1`) |

Batch 15 scored 0.63, 0.33, 0.71, 0.00, **1.00, 1.00, 1.00**: the dog-ownership health check, the Maryland
and DC law school outreach plan and the twelve-hotel Disney comparison passed every rubric item. The four
fixes that mattered most for them were the long-lived sessions, the ledger, persistence against
plain-text answers and IPv4-first provider calls.

### Batch 16 (October 18)

| Cause | Label | Fix |
|---|---|---|
| A shop's bot check led the agent to ask the person to take over its hidden tab; the request failed and ended the run at 28 turns, its narration the only answer | H | A request nobody answers is planned around (`83c910b4`) |
| A stopped run's answer was only the failure, though it had found most of what was asked | H | A stopped run writes its answer from the transcript before the stop reason (`d98fbb95`) |
| CryptPad's "New > Rich text" opened the document in a new window, which from a hidden agent tab went to the person's window | K | Pages an agent's own tab opens load in that tab (`8f774c91`) |

"invocation.failed" in these reports is often the agent's own "not finished" ending with a full
answer, which the judge grades like any other.

Run-to-run variance is large: the shopping task scored 0.75, 0.50 and 0.75 on three runs of nearly the
same code. Milestone numbers need several trials per task.

The local eval plan was raised to Ultra+ by editing the local billing database (the active
subscription row and the license record, both `pro` before); restore both after the campaign.

Effort, on the pricing task with the agent's own tab: at `low`, Haiku opens one page and stops; at
`medium` and `high` it visits and toggles all three vendors' pages. The first batch runs at `medium`,
Haiku's own default, while the per-turn effort policy is built.

### Batch 17 (October 18)

Ten tasks, one perfect (the hard 341d7a7056), rubric average 0.54, $2.46 for the batch and $11.37 of
the $50 cap so far. Eight of ten runs ended `invocation.failed`, mostly the agent's own "not finished"
ending; one hit the 20-minute timeout one rubric item short (0.86). The batch ran on hidden agent tabs.
The next ones run in agent windows (docs/agents/cursor-companion.md, "Agent windows"), so their
first job is to show the move cost nothing.

### Batch 18 (October 18): stopped, the app signed out

Batch 17's ten tasks again, now in agent windows. The first two failed fast and the next three never
started: the desktop's session had been revoked. Every new window restores the saved account at
startup, and a restore without an account replaced the app's live cookie jar with an empty one. The
device worker kept the old jar and the next restore loaded the keychain copy, so two jars rotated one
refresh token until the server saw a stale one and deleted the session. Agent windows open once per
run, so a batch hit it quickly. They no longer change or forget the account (`auth_cookies.rs`);
they report whether the person's session is the one they expect. Spend: $0.07.

### Batches 18 to 20 (October 19): agent windows

| Batch | How | Perfect | Rubric avg | Typical run |
|---|---|---|---|---|
| 18 | Agent windows, one task at a time (6 of 10 before a restart) | 0/6 | 0.35 | 7–12 min |
| 19 | Three at a time, agents' own time estimates | 0/10 | 0.29 | 18 min median |
| 20 | Three at a time, estimates held to 30 minutes (4 clean results before a restart) | 0/4 | 0.40 | 6–30 min |

Many fixes landed in agent windows along the way: background sign-out, cross-talk between windows,
request races, duplicate tabs, held claims, model stream stalls and per-run screenshots. Speed
and reliability improved; accuracy did not. The plan that followed the analysis of all 116 graded runs
is now part of [agent-harness.md](../harness.md). No more batches until those changes
are in.

### Comparison pass A (October 19): harness v2, first half

Batch 17's ten tasks, three at a time in agent windows, with the first harness-v2 changes: Misty's
own tools deferred (first turn 22,000 → 10,700 input tokens), cache-safe working set, content-first
snapshots, pushed page state, proof-tab check, loop guard and time estimates.

| | Perfect | Rubric avg | Median run | Median tools | Cost |
|---|---|---|---|---|---|
| Batch 17 (hidden tabs, one at a time) | 1/10 | 0.540 | 724 s | 92 | $2.46 |
| Pass A (agent windows, three at a time) | 0/10 | 0.367 | 926 s | 78 | $1.97 |

Pass A matches batches 18 to 20, so the changes did not recover what the move into agent windows
lost. What the runs showed:

- **Slower turns.** 17.3 s per turn at the median against 13.0 s, though input fell from 82,000 to
  49,000 tokens: the time went to device jobs. `screen_open`'s p90 was 30 s, its timeout. Nine tab
  opens were never claimed (the realtime socket reconnects every 15 to 60 s here and dropped their
  notifications; the worker waited 60 s to look again) and six were claimed but never began (the
  claim's answer was lost on the way).
- **No breadth.** Tasks with 10 to 20 items were worked one at a time. `agent_delegate` sat behind
  `agent_tool_load` and was never used, and the research budget's "Answer now" note ended runs early.
- **Finishes.** Every run called `agent_finish` 4 to 7 times; 15 of the refusals were "not finished
  yet". One run ended on its progress line ("Next: I'll read …") as its answer.

Fixed before pass B: held claims for ten minutes after any job and a 25 s reconcile; a claim not
begun within 8 s goes back to the queue, and held claims look again every 5 s; sub-agents are
offered to every run with its own tabs, and their tabs open in the parent's agent window; the budget
note sends such runs to work on pages instead of answering; a bare progress line is sent back; the
prompt asks for several similar items per turn. Spend so far: $19.56 of $50 (eval ledger).

### Comparison pass B (October 19): harness v2 with the fixes above

| | Perfect | Rubric avg | Median run | Median tools | Cost |
|---|---|---|---|---|---|
| Batch 17 | 1/10 | 0.540 | 724 s | 92 | $2.46 |
| Pass A | 0/10 | 0.367 | 926 s | 78 | $1.97 |
| Pass B | 0/10 | 0.406 | 966 s | 67 | $1.55 |

Three tasks rose (341d7a7056 0.57 → 0.86, 48a6cb73b8 0.00 → 0.50, adc644f33f 0.14 → 0.43) and three
fell, two of them after 34 and 38 minutes with few tools: device jobs slowed through the pass
(`screen_open` median 4.8 s → 7.4 s, p90 41 s; snapshots timing out). The cause was on the device:
250 WebKit page processes for 54 open pages. Destroying an agent window left its pages' processes
behind, so every run made the app slower for the next. Agent windows now close their pages one by
one before they go (`close_window_pages`), but that was not the whole leak: a fresh app starts
with four page processes and still gains about eight per run (4 → 12 → 20) after the run's window
and pages are gone. The dock, lock and ring hold views weakly and the eval's private session is one
per app, so the holder is still unknown; restart the app before each pass until it is found.

Still open: runs give up early (one tried to finish at step 20 of 67 and stopped 8 minutes into its
own 45-minute estimate). Give-ups are now sent back up to eight times while a run is under 80% of
its estimate. The next comparison runs on a fresh app with both changes.

### October 20: one verification turn, and free models

Outside the eval, the stacked finish guards made short questions loop: an answer that said one
release date was unconfirmed was sent back as an early give-up and refetched the same site again
and again. The citation, unbacked-claim, proof-tab, requirements-review and give-up checks now run
together once (`src/finish-verification.ts`) and the next finish stands; sending a partial finish
back to work is for long requests only. The loop guard now remembers addresses across the whole
run, ignores `www.`, scheme and tracking differences, and also notes a call that failed twice and
six of the last eight pages on one site.

The campaign's Anthropic credit is nearly spent, so later passes run on NVIDIA's free hosted models
([free-model-evals.md](free-model.md)). Its scores compare only with passes on the same model:
the first is batch 17's ten tasks before and after the change above, on the Mac.

### October 20, evening: one task at a time on Nemotron

Agent and judge are `nim/nvidia/nemotron-3.5-super-vl-120b-a12b`, not Haiku. GLM-5.3-Flash, the
model free-model-evals.md chose, takes at most 8 images a prompt on NVIDIA and fails the judge; of
the fallbacks only Nemotron passed all four smoke checks. The paid keys were taken out of the dev
stack for these runs. Tasks now run one at a time across all 200, each read and fixed before the next.

The before/after comparison on batch 17 was dropped: its first task showed the harness itself
ending runs, and those causes came first.

| Cause | What happened | Change |
|---|---|---|
| A clock ended long tasks | The eval cancelled at 60 minutes, the runtime allowed 30 minutes of execution, and the time budget forced an answer past its estimate | No clock in the eval: a progress watch (`evals/odysseys/watchdog.ts`) looks every 3 minutes and stops only a run that went quiet or repeats itself. Dev evals get 4 hours of execution (migration `20271103000000`), the time budget lets a run past its estimate continue while its results are new, and the judge retries only a call that went quiet |
| Narration ended runs | The model narrates its next move ("Let me try the link directly.") and sometimes makes no call; the loop took that as the answer | Such a line is a progress note and goes back, until three text-only turns in a row |
| A recap replaced the answer | Asked to confirm with agent_finish, the model wrote "my full answer is above" and a recap became the final answer | An unreported run keeps its fullest answer since its last tool call (`closingText`) |
| Garbled document ids | The model spliced a page's documentId with its tab's scopeId, so every action on a site failed as stale and the run gave the site up | The run repairs a missing or garbled documentId from the tab's latest one (`src/document-ids.ts`); a real older id still fails |
| Guessed domains | `jjs-house.com` for `jjshouse.com`: the tab never loaded and the site was called a blocker | screen_open and browser_navigate refuse a host with no DNS record and say to search for the real address |
| Navigate reported the old page | A navigation that never left the old document was returned as the new page | The old document is marked first; the landed page must be another document, a bot check is waited out, and an unchanged page says so |
| Popups | An empty backdrop left by a hidden cookie banner, and a close control that did nothing | Empty covers are hidden; a covered click closes the popup and checks it went (close, Escape, then hide in the agent's tab) |
| Opaque failures | A run failed with nothing logged; a failed read was reported as "uncertain" | Unclassified runtime failures are logged; reads and calls that never reached the page fail plainly |

Checkpoints: `MISTY_ODYSSEYS_RESUME` continues a stopped task in its own conversation after a fix,
with the request and last answer as history, and grades both runs as one trajectory.

| Task 46ecc9a5dc (medium) | Rubric | Ended |
|---|---|---|
| First run | 0.25 | Narration, after 4 minutes |
| Rerun with the narration fix | 0.38 | Narration again, 15 minutes |
| Resumed | 0.50 | Recap replaced the answer |
| Resumed again | 0.75 | Completed; missed JJ's House (picked a prom dress) and ALS (searched the full product name only) |

The last two misses were the agent's choices; the prompt now asks it to search again with fewer
words before saying a site lacks an item, and to match the category it was asked for.

| Task 8f005e9f09 (hard) | Rubric | Ended |
|---|---|---|
| First run | 0.33 | Completed in 10 of its estimated 45 minutes; most tabs were read as about:blank and two insurer pages were 404s |
| Rerun with the fixes below | 0.78 | Reported completed but marked failed; missed the count (8 of 10 pediatricians) and some daycare tabs |

What task 8f005e9f09 showed, and the changes:

- **New tabs were read before they loaded.** screen_open returned as soon as the tab existed, so
  the run's first read of every new tab was about:blank, and runs that open tabs in batches worked
  from blanks. A new agent tab now waits for its first page (`browser_webview_await_load`, at
  most 15 s, or 25 s past a bot check); each took 0–2 s in the rerun.
- **Error pages read like answers.** A snapshot whose title or heading says 404 or "can't find
  that page" now starts with a note that the address is wrong and to find the page by search.
- **A reported finish was marked failed.** Two sub-agents that never started (`tool_not_attempted`)
  counted as unconfirmed effects and turned a completed run into a failure; never-attempted
  actions no longer count.
- **The judge returned no verdict** for two rubrics (thinking used the 4,000-token cap). Free
  models get 16,000 tokens and a reply without a verdict is asked again; `MISTY_ODYSSEYS_REGRADE`
  judges a saved run again without rerunning it.
