# Agent checkpoints: resume the open items, never redo the finished ones

Status: all five phases built 2026-10-21, uncommitted, not run against a live stack. Decisions below were made by the user.

Built as: runtime `src/ledger.ts` (`agent_ledger` tool, reconcile, report), app `src/features/agents/checkpoints/` (ledger comment, resume turn, `LedgerTable`), and `MISTY_ODYSSEYS_RESUME_FAILED` in the Odysseys eval. "Start from here" is Retry on any older answer's table: it drops what came after and resumes that ledger. The model-facing tool surface is not narrowed on resume: the resume prompt scopes the work to the open rows instead.

## Problem

A run with ten parts finishes nine and fails one (captcha, bad link, missing input). "Try again" re-sends the
prompt, so the model redoes all ten. The finish report already names the failed part
(`agent_finish.remaining`, `src/features/agents/progress/unfinished.ts`), and the chat history sent to the model
comes from this device's copy (`historyTurns`), but nothing records which parts passed or what proves it.

## Decisions

1. **The model writes the ledger as it works.** A small ledger tool the agent updates; the finish check
   reconciles it against evidence and can downgrade a `done` that has none to `pending`.
2. **Durable evidence only.** An item is `done` when backed by a kept tab or URL, a notebook entry or file, or a
   tool receipt (a recorded successful action with its id). A bare claim does not count, so resume never trusts it.
3. **Row actions depend on the row.** Retry, Retry with a hint, Skip, Take over. "Retry with a hint" is the way a
   row asks the person for input (a birthday for a form, a better link), like questions in Plan mode.
4. **Evals resume failed items only.** A full batch runs once everything has passed, even if it took many
   attempts, and then periodically as the real score. Never rerun the whole batch on every attempt.

## Design

### Ledger

One row per requirement, stored with the assistant message in this device's chat copy (`misty.db`):

```
id, requirement, state: pending | done | failed | blocked | skipped,
evidence: { kind: "tab" | "note" | "file" | "receipt", ref, summary } | null,
reason, needs: "none" | "input" | "takeover", hint?
```

- The agent creates the rows from its plan or notebook, then updates them with the ledger tool.
- `finish-verification` already runs one combined check. It gains a ledger pass: a `done` row without evidence
  goes back to `pending`, and `remaining` is derived from the ledger so the table and the ledger never disagree.
- Evidence kinds map to things the harness already tracks: kept proof tabs (`proof-tabs.ts`), notebook and
  file writes, and tool results with ids.

### Resume

- A resume is a `continuation` turn (trigger already exists) that carries the ledger: done rows with evidence,
  open rows with their reasons and any hint. The prompt tells the agent not to redo done rows.
- The tool surface for the resume is limited to the open rows. The finish check passes once those are closed.
- Cheap re-verification: when evidence is a live page (kept tab or URL), open it once and confirm it still shows
  the result; durable evidence (note, file, receipt) is trusted as is.
- No new user message is added, and the retry replaces the failed answer in place (already built: rewind and
  resend from the prompt's place).

### Row actions in the "Not finished" table

| Action | What happens |
|---|---|
| Retry | Resume with that row open and nothing else changed. |
| Retry with a hint | Inline field for what the agent needs (a birthday, a link). Saved on the row as `hint`; resume carries it. |
| Skip | Row becomes `skipped`; the run can finish and the answer says it was dropped. |
| Take over | The person gets the run's browser tab (captcha, login), then Continue resumes that row. |

Rows that need input show it as the reason, so the right action is the primary button. Actions are real
buttons (AGENTS.md agent-conversation rules), status stays text plus icon.

### Checkpoints you can choose

"Start from here" on any turn resumes with the ledger as it stood at that turn. This is the existing rewind plus
a ledger snapshot per assistant message, so no separate checkpoint store.

### Evals (`server/apps/agent-runtime/evals/odysseys`)

- Save the ledger per case. A rerun after a fix resumes only failed and blocked rows.
- A case counts as passed only when every row is `done` with evidence or intentionally `skipped` by the case.
- Full batch: run once all cases have passed in resumed form, then on a schedule. The full-run score is the
  reported number; resumed passes are for iteration only.

## Phases

1. **Ledger and tool.** Schema, storage on the message, ledger tool, finish-check reconciliation, `remaining`
   derived from the ledger. Tests: downgrade without evidence, derivation, persistence.
2. **Resume turn.** Continuation payload with the ledger, tool surface limited to open rows, live-page
   re-verification. Tests: nine done rows are not touched on resume.
3. **Row actions.** Retry, Retry with a hint (inline field), Skip in the table; Take over wired to the agent
   browser tab.
4. **Choose a checkpoint.** Ledger snapshot per assistant message; "Start from here".
5. **Evals.** Per-case ledger, resume-failed-only runner, full-run gate and schedule.

## Risks

- Stale evidence: a page can change between runs. Live-page evidence is re-checked once on resume; a recheck
  failure turns the row back to `pending` with a reason.
- Model-written ledgers can be sloppy. The harness reconciles against evidence rather than trusting state.
- Take over needs the run to hold a tab open while it waits for the person; reuse the existing wait/release
  path for runs that ask the user (`releasePendingWait`).
- Resumed benchmark passes can hide regressions in earlier rows, which is why the full run stays the score.
