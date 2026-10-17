# Odysseys campaign

The goal, rules and loop for improving Misty's agent against Odysseys, the long-horizon web
benchmark other AI browsers report on. Written October 17, 2026. Background and the failures that
are already known: [agentic-architecture-review.md](agentic-architecture-review.md).

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

"invocation.failed" in these reports is often the agent's own "not finished" ending with a full
answer, which the judge grades like any other.

Run-to-run variance is large: the shopping task scored 0.75, 0.50 and 0.75 on three runs of nearly the
same code. Milestone numbers need several trials per task.

The local eval plan was raised to Ultra+ by editing the local billing database (the active
subscription row and the license record, both `pro` before); restore both after the campaign.

Effort, on the pricing task with the agent's own tab: at `low`, Haiku opens one page and stops; at
`medium` and `high` it visits and toggles all three vendors' pages. The first batch runs at `medium`,
Haiku's own default, while the per-turn effort policy is built.
