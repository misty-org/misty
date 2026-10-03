# Agentic browser — benchmark results

Results of the Phase 0 benchmark (`server/apps/agent-runtime/evals/browser`) for [the plan](agentic-browser.md). Each row is three runs of the 16 fixture tasks with `openai/gpt-6-luna` (the development `MISTY_AGENT_MODEL`), low reasoning, judged by the same model. Live-app tasks were skipped: they need signed-in test accounts (see the eval README).

Reports live in `server/apps/agent-runtime/evals/browser/reports/` (git-ignored).

## October 10, 2026

| Build | Passed | Median | p90 | Mean model turns | Input tokens | Output tokens |
|---|---|---|---|---|---|---|
| Phase 1 (text-first page layer, 2,200-token output cap) | 38 / 48 (79%) | 8.9 s | 24.4 s | 5.4 | 1,117,261 | 20,068 |
| Phases 1–3 (adds skills, snapshot pruning, cache breakpoints, 8,192-token cap) | 46 / 48 (96%) | 8.2 s | 16.1 s | 4.5 | 865,734 (−23%) | 13,818 (−31%) |

Per task, baseline → Phases 1–3:

| Task | Baseline | Phases 1–3 |
|---|---|---|
| signup-form | 1/3 | 3/3 |
| signup-retry | 1/3 | 3/3 |
| editor-assignment | 0/3 | 3/3 |
| grid-fill | 1/3 | 3/3 |
| table-extract-paged | 2/3 | 1/3 |
| the other 11 tasks | 3/3 each | 3/3 each |

Notes:

- **Where the time goes.** Tools take 7–10% of each run; the rest is the model. Turn count and output length matter more than tool speed, which is why the skills (one call for a grid paste or a formatted document) and fewer turns moved p90 most.
- **Signup.** The baseline's misses came from `select` on a type-ahead field (an input with suggestions). `select` now types the option into such fields, and `pickers.choose` handles autocompletes.
- **Editor.** The check first required an `<h2>`; the task only asks for "a heading", so it now accepts any level. Phases 1–3 runs were re-scored with the fixed check from their saved page state. Baseline runs predate saved page state and keep their original verdicts; those runs typed plain text with no heading or list at all.
- **Paged table.** The miss in Phases 1–3 left out one first-page item after moving to page 2; it is a model attention error, not a tool failure. Three runs per task cannot separate a one-run difference from noise.
- **Injection.** No run followed the hidden instruction; the consequential gate also refuses its "Delete account" click.
- **Not measured here.** The device hop (job queue, claim and native dispatch) and MCP overhead only exist in full-stack runs; use `npm run trace -- <invocation id>` on a real run. Plain chat runs traced on October 10 spent 33% of their time in tools, mostly connected-app calls.


## Device hop (October 10, 2026)

Read-only calls now send one runtime checkpoint instead of two, and the desktop holds its next
claim open after browser work, so the next browser job skips a notification and a claim request.
Neither has been timed on a full-stack desktop run yet, by the owner's choice. After a real agent
run in the desktop app, `npm run trace -- <invocation id>` shows each device job's queue, claim and
run time.

## First live task (October 10, 2026)

`research-live` (compare three vendors' cheapest paid plans and cite their pricing pages) is the one
live task that needs no account. It first scored 0 of 3, which exposed two harness gaps and one
agent gap:

- The judge saw only the final page, so prices read on earlier pages counted as unsupported. It now
  also sees the newest read of each page the agent looked at, including the page an action
  returned (`browser.eval.ts`, `judge.ts`).
- The eval's prompt lacked production's current date, so one answer invented a date. It now gets
  the same run context.
- The agent sometimes filled a price in from memory or dropped its billing terms. Production's
  browser guidance now says to report facts as the pages show them, with their conditions, and
  to say when something could not be confirmed.

After these, 2 of 3 runs passed (gpt-6-luna, about 25 s each); the third gave grounded, qualified
prices that the judge marked down for lacking a month-to-month Evernote price the page does not
offer. The 17 fixture tasks still pass. The other 21 live tasks need signed-in test accounts.

## Engine (October 10, 2026)

The numbers above were measured in headless Chromium running the same page code. From now on the
benchmark runs in Misty's own browser, the system webview, through the desktop's agent path
(`src-tauri/src/infra/browser_eval_bridge.rs`); see the benchmark README to run it.

## Live Google tasks in Misty (October 10, 2026)

Run in Misty's own browser, signed in to the owner's Google account, on files made for the run
(gpt-6-luna, one run each):

| Task | Result | Time |
|---|---|---|
| docs-assignment | pass | 19 s |
| gmail-draft (draft only, not sent) | pass | 20 s |
| sheets-fill-range | pass | 15 s |
| sheets-formula-column | pass | 14 s |
| sheets-sort-chart | pass | 22 s |

Getting there fixed three things the Chromium stand-in had hidden: Google Sheets never started in
Misty (a read-only `window.ipc` from wry), the Docs skill's paste did nothing in WebKit, and skill
reads collapsed line breaks. Forms and Classroom were not run: one submits a real response and the
other needs a class.

