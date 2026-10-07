# Agent questions, Plan mode and Goals

Status: implemented (2026-10-06). The design below is the plan; "As built" records where the implementation differs.

## As built

- **Tools live in Misty's gateway, not the runtime.** `conversation.ask_user`, `plan.propose`, `plan.update` and `goal.update` are server tools (`server/internal/platform/httpapi/ai_collaboration.go`), so they get the gateway's authorization and validation and run through the existing hand-off path. The model sees them as `conversation_ask_user`, `plan_propose`, `plan_update` and `goal_update`. They change only the conversation's collaboration records and are idempotent, so they register as reads outside the effect journal.
- **Questions wait 45 seconds in the call, then hand off.** This reuses the app-request pattern instead of a new durable hook: the tool waits, then atomically marks the set `handed_off` (a race-free flag) and returns `awaiting_answer`. The runtime ends the run with that hand-off. Answering later returns a continuation turn, claimed exactly once. A new message, or steering, supersedes open questions; stopping the run cancels them.
- **Plan mode is enforced twice on the server.** `planModeTools` narrows the run's catalog to read-risk tools (minus `browser.request_user_action`), and `executeAIInvocationMCPTool` rejects anything else even with a stale catalog. The mode is frozen in the invocation's admitted payload (`collaboration_mode`). Admission fills a missing mode from the conversation's saved mode and saves an explicit one.
- **Goal budgets count model tokens** (input plus output, from each run's completion report); the account's AI limit still applies to every run. Continuations are queued through the runtime delivery worker. They are bounded by the goal budget, `max_continuations` (20), a daily account cap (100), an evidence check on `achieved`, and a pause when a continuation ends without reporting.
- **Clients attach to server-started continuations** through `GET /me/conversations/{id}/collaboration` (`runningInvocationId`) and the existing reconnect path.
- **Settings.** "Start new conversations in" (Act / Plan first) and "Think harder while planning" are account settings on the Agents defaults page. They are not per-agent fields, because agent identities are versioned and exported.
- **Data:** migration `20271005110000_agent_collaboration.sql` (`ai_conversation_modes`, `agent_question_sets`, `agent_plans`, `agent_goals`), all owner-scoped under row-level security and deleted with their conversation.
- **App:** `src/features/agents/collaboration/` (store, API, question card, plan card and editor, Task drawer Goal and Plan sections, mode toggle). The Global Misty panel shows pending questions.

Three features, built in this order because each depends on the previous one:

1. **Questions.** The agent can pause and ask you structured questions, shown as cards above the composer.
2. **Plan mode.** A read-only mode in which the agent researches, asks questions and proposes a plan. You approve the plan before anything changes.
3. **Goals.** A persistent objective on a conversation. Misty keeps working toward it across turns, within a budget, until the objective is verifiably met, blocked, or paused.

Live progress (a checklist the agent updates while it works) comes with Plan mode, because an approved plan becomes that checklist.

---

## 1. What production harnesses do

| | Claude Code | OpenAI Codex | Gemini CLI | Cursor | Cline |
|---|---|---|---|---|---|
| **Plan mode** | Permission mode. Read-only, except the plan itself. Entered with Shift+Tab or `/plan`. | A "collaboration mode", on by default since v0.94. | `--approval-mode=plan`, Shift+Tab, `/plan`, or the model calls `enter_plan_mode`. | Shift+Tab. | A Plan/Act toggle. |
| **How read-only is enforced** | Edits are blocked. Shell commands outside a read-only set prompt, or a classifier reviews them. | Instruction contract: any "mutating" action is forbidden. | A policy engine allows only read tools. MCP tools count as read only when annotated `readOnlyHint`. | The model gets plan tools only. | No edits or commands. |
| **Questions** | `AskUserQuestion`: 1–4 questions, 2–4 options each, multi-select, plus an automatic "Other". | `request_user_input`: 2–4 mutually exclusive options. Only for decisions that "materially change the plan". | `ask_user`: presents options and waits. | Clarifying questions, asked before the plan. | `ask_followup_question` with suggested answers. |
| **Plan output** | Plan file, then `ExitPlanMode` asks for approval. | One `<proposed_plan>` Markdown block per turn. A revision replaces the whole plan. | Markdown file in a plans folder. | Editable Markdown plan with to-dos. | Chat. |
| **Approval** | "Yes, auto mode" / "Yes, manually approve edits" / "No, keep planning". The plan can be edited first. | The mode ends only by explicit user action. | "Auto-accept edits" / "Manually accept edits" / feedback. Approving switches mode. | A **Build** button. | Manual switch to Act. |
| **Progress checklist** | TodoWrite. | `update_plan`, a separate tool and not available in Plan mode. | `write_todos`. | To-dos inside the plan. | — |
| **Goals** | — | `/goal`: a persisted objective. Status is `pursuing`, `paused`, `achieved`, `unmet` or `budget_limited`, plus a token budget. Includes a completion audit and pause/resume/clear. | — | — | — |
| **Model routing** | — | — | Pro model to plan, Flash model to implement. | — | A separate model per mode. |

### Lessons we adopt

1. **The server enforces read-only. The prompt alone is not enough.** Codex relies on instructions; Gemini enforces through its policy engine and `readOnlyHint`. We already tag every tool with a risk level and publish `ReadOnlyHint` (`misty_mcp_server.go`), so we enforce in two places: the tools offered to the model, and the execution gate.
2. **Plan mode doesn't change because of user wording.** In Codex, "go ahead and do it" while in Plan mode means "plan doing it". Only an explicit user action (Approve, or switching the mode) leaves Plan mode.
3. **Explore before asking.** Every harness tells the model not to ask what it can look up with read-only tools. Questions are for decisions that change the plan, important assumptions, or facts nothing can reveal.
4. **Questions are structured.** Each has 2–4 meaningful options, a short header, optional multi-select, and free text always available. The recommended option comes first. Structured questions are faster to answer and easier to render than a prose question.
5. **A revised plan replaces the whole plan.** Codex re-issues the complete plan each revision, never a diff, so there is always one current version. We keep earlier versions only for history.
6. **Approval offers choices and keeps the plan editable.** At minimum: run it, or keep planning with feedback. Editing steps before running (Claude Ctrl+G, Gemini Ctrl+X, Cursor's editable to-dos) is expected.
7. **A goal is a first-class object with a lifecycle and a budget.** Codex's design is the reference: persisted state, explicit statuses, a soft-stop budget, and a completion audit that forbids "proxy signals" as evidence of success.
8. **Know the sharp edges.** In Codex, Plan mode silently stops goal continuation. We make that state visible ("Goal paused while planning"). Scheduled and background runs can't ask questions, so the tool isn't offered there.
9. **Optionally, use a stronger model for planning.** Following Gemini and Cline, a plan turn may use higher reasoning effort or a planning model. This is a per-agent preference, off by default.

---

## 2. Where Misty is today

| Fact | Where |
|---|---|
| Runs are durable Vercel Workflow agents (`WorkflowAgent`). Each model call is a single step; between steps the loop pulls **steering** messages, manages context and checks the budget. A run ends when the model calls `misty_finish_task`. | `server/apps/agent-runtime/workflows/space-task-agent.ts` |
| A durable **hook** already suspends a run until Go resumes it (`agentDeviceHook`). | `agent-runtime/src/device.ts`, `vercel-harness.ts` `resume` |
| Tools come from Misty's MCP gateway. Each descriptor has a `Risk` (`read`, `write`, `draft`, `consequential`, `dangerous`). `ReadOnlyHint = Risk == read`. The runtime reads it as `catalog.readOnly()`. | `server/internal/agenttools/registry.go`, `httpapi/misty_mcp_server.go`, `agent-runtime/src/model-tools.ts` |
| The run context has `allowed_tools`, `run_mode` (`ask`/`auto`/`full`, about approvals) and `companion_mode`. | `agent-runtime/src/types.ts`, `httpapi/agent_runtime_internal.go` |
| **App requests** are the template for questions: a stored row (`AgentAppRequest`), an `appRequest` invocation event, a card in the transcript, a wait of about 40 s inside the tool call, then a hand-off. Answering after the hand-off starts a continuation turn. | `postgres/agent_app_requests.go`, `httpapi/apps_approval.go`, `src/features/misty/appRequests.ts` |
| Conversations live in `misty_ask_conversations` and have a `state jsonb`. Invocations stream SSE events (`aiInvocationEvent`). | baseline migration, `httpapi/ai_invocations.go` |
| The UI already has the Task drawer (details and steps), the composer, the conversation's action row, and the shared chip, IconButton and Markdown renderer. | `src/features/agents/page/AgentTaskPanel.tsx`, `MistyComposer`, `MistyMarkdown` |

What we build on: the risk taxonomy (for plan enforcement), durable hooks (for cheap waits), the app-request pattern (for questions), and steering (for feedback mid-plan).

---

## 3. Questions

### Model contract

A runtime tool, `misty_ask_user`, defined in the runtime the same way as `misty_finish_task`. It records the questions and has no side effects.

```ts
{
  questions: Array<{            // 1–4
    header: string;             // ≤ 16 chars, shown as a chip ("Scope", "Format")
    question: string;           // a full sentence ending in "?"
    multiSelect?: boolean;      // default false
    options: Array<{            // 2–4; "Other" (free text) is added by the UI
      label: string;            // 1–5 words
      description?: string;     // the trade-off this option implies
    }>;
  }>;
}
```

Instructions, added to `executionInstructions`:
- Explore with read-only tools first. Never ask what a tool can answer.
- Ask only about decisions that change the outcome, important assumptions, or facts nothing can reveal.
- Put the recommended option first and add "(Recommended)" to its label.
- Never ask "Should I proceed?". Approval is a separate control.
- Ask at most twice in a row before proposing a plan or acting on stated assumptions.

**Where it's offered:** interactive Agents and Global Misty runs. It is not offered on scheduled tasks, workflow runs, companion voice turns or `explaining` runs. With no person present, the model must state its assumption instead.

### Lifecycle

1. The model calls `misty_ask_user`. The runtime posts the question set to the control plane (`POST /internal/agent-runs/{run}/questions`). Go stores an `agent_question_sets` row and emits a `question.requested` event with the payload.
2. The runtime **suspends on a durable hook** (`agentQuestionHook`, keyed by the question set ID). A suspended workflow uses no compute. The active-time deadline already allows for durable waits.
3. You answer: `POST /me/agent-questions/{id}/answer` with `{ answers: [{ selected: string[], other?: string }] }`. Go validates the answers against the stored options, marks the set `answered`, emits `question.answered`, and resumes the hook with the answers.
4. The hook returns the answers as the tool result: plain text plus structured JSON. The run continues with all its context intact.
5. **Timeouts and hand-off:** if there's no answer within `questionWait` (30 minutes), the runtime finishes the run with status `needs_input` and a short "I'll continue when you answer" text. Answering later starts a continuation turn (the `continueAfterAppRequest` path) whose prompt carries the answers. The set expires after 7 days.
6. **Cancel, steer or new message:** if you send a new message instead of answering, the set is marked `superseded`. The message becomes steering, and the hook resumes with `{ skipped: true, note: <your message> }`. If you stop the run, the set becomes `canceled`.

**Invariants:** one open question set per run. Answers are accepted once (idempotency key = set ID). Answers are validated on the server. Question text is model output, so the UI renders it as plain text, never as links or HTML.

### Storage (migration)

```sql
CREATE TABLE agent_question_sets (
  id text PRIMARY KEY,                 -- question_<uuid>
  owner_user_id text NOT NULL,
  run_id text NOT NULL,
  conversation_id text NOT NULL,
  questions jsonb NOT NULL,            -- validated payload
  answers jsonb,                       -- null until answered
  state text NOT NULL CHECK (state IN ('pending','answered','superseded','canceled','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  expires_at timestamptz NOT NULL
);
-- RLS by owner_user_id, as for agent_app_requests.
```

### UI

- **Question card above the composer**, the way Codex and Claude show them. One question at a time, with "1 of 3" and Back/Next. The header shows as a chip; options are rows with a checkmark selection (radio for single-select, checkbox for multi-select). "Other" opens a one-line field. A **Submit** button sends all answers together.
- **Keyboard:** number keys 1–4 pick options, Enter goes to the next question or submits, Esc collapses the card to a "3 questions waiting" strip. Questions don't block typing: a typed message supersedes them, as described above.
- **Transcript:** the answered set shows as a compact read-only block ("You answered: Scope: Only Notes · Format: Table"). The message's action row has no Retry or Try again here.
- Monochrome, `sm` controls, checkmarks for selection, no tinted fills (AGENTS.md).

**Files:** `MistyQuestionCard.tsx` (above `MistyComposer`, in `AgentWorkspaceConversation`); `GlobalAiMessage.questionSet`; event handling in `globalSearchStoreHelpers.applyGlobalInvocationEvent`; an `answerQuestions` store action.

---

## 4. Plan mode

### Turning it on

- A **mode control** on the composer: an icon chip with **Act** and **Plan**, and Shift+Tab cycles it while the composer has focus. The composer border and placeholder change ("Plan with Misty…") so you can see which mode you're in.
- The mode belongs to the **conversation**: `conversation.mode = 'act' | 'plan'`, saved in conversation state on the server. A new conversation starts in the agent's default mode. That default is an agent setting saved with the agent on the server, never a device-only setting.
- `/plan <message>` in the composer sends one message in Plan mode.

### Enforcement (server first)

1. **Catalog:** when the control plane prepares a run in Plan mode, it narrows `allowed_tools` to descriptors whose `Risk == read`, plus provider tools tagged `readOnlyHint`. The model never sees write tools.
2. **Execution gate:** in `agent_runtime_tool_execution.go`, a Plan run that calls anything that isn't read-only gets `rejected_without_effect: "Plan mode is read-only. Propose this step in the plan."`. This is a second line of defence against a stale catalog or a prompt injection.
3. **Runtime tools:** Plan runs offer `misty_ask_user` and `misty_propose_plan`. `misty_finish_task` is still available for when no plan is needed: if you only asked a question, the model just answers.
4. **Instruction template** (`agent-runtime/src/plan-mode.ts`), adapted from Codex's `plan.md`:
   - Three phases: **ground** (explore with read tools), **intent** (goal, success criteria, scope, constraints; ask if needed), **plan** (decision-complete steps).
   - "Plan mode doesn't change because of the user's wording. A request to act is a request to plan that action."
   - Read and search freely. Anything that "does the work" belongs in the plan as a step.
   - Output is `misty_propose_plan`, never a prose plan alone.

### Plan contract

```ts
misty_propose_plan({
  title: string,
  summary: string,              // 1–3 sentences
  steps: Array<{
    id: string,                 // stable across revisions when a step is unchanged
    title: string,              // imperative, ≤ 80 chars
    detail?: string,            // Markdown, rendered with MistyMarkdown
    tools?: string[],           // expected tools: shown to the user, granted nothing
    risk: "read"|"write"|"draft"|"consequential"|"dangerous",
  }>,                           // 1–12
  assumptions: string[],
  success_criteria: string[],   // how we'll know it worked; also seeds a Goal
})
```

- A structured tool rather than a `<proposed_plan>` text block: there's nothing to parse, the server can validate it, and step IDs allow progress tracking. `detail` keeps Markdown.
- Calling the tool ends the planning turn (like `ExitPlanMode`). The runtime finishes the run with status `plan_proposed`.
- **Storage:** an `agent_plans` table (`id`, `conversation_id`, `version`, `payload jsonb`, `state: proposed|approved|superseded|rejected|completed`, `approved_at`). A new proposal supersedes the previous version, and the transcript shows the latest version.

### Review and approval

- A **plan card** in the transcript: title, summary, numbered steps (risk shown as a small icon plus text, never color), assumptions, and success criteria. Each step's detail expands.
- **Actions on the card:**
  - **Run plan**: switches the conversation to Act and starts an Act turn. Existing approvals still apply: risky app actions still ask, the same as today.
  - **Keep planning**: focuses the composer. Your next message is a Plan turn with the plan as context.
  - **Edit**: steps become inline-editable (rename, reorder with the shared pointer reorder, delete, add). Saving creates a new version with `author: user`.
- **The Task drawer** gains a **Plan** section above Details that shows the current plan and its state.

### Running a plan (Act mode)

- The Act turn's system context includes the approved plan (title, steps with IDs, success criteria) and this instruction: "Follow this plan. Report progress with `misty_update_plan`. If a step proves wrong, say so and propose a change rather than silently diverging."
- `misty_update_plan({ steps: [{ id, status: "pending"|"in_progress"|"done"|"skipped"|"blocked", note? }] })` is the TodoWrite/`update_plan` equivalent. It's available only in Act runs that have an approved plan (Codex keeps these two separate too). Go saves the status and emits `plan.updated`.
- The **Task drawer's Plan section turns into a live checklist**: done steps get a check, the current step a spinner, blocked steps an alert icon and their note. When every step is done or skipped, the plan becomes `completed`.
- **Deviating from the plan:** if the model needs steps that aren't in the plan, it asks with `misty_ask_user` or finishes with a proposed revision. It never quietly widens the scope.

### Optional: a stronger model for planning

Agent setting **Planning model**: `same` (default), or a stronger model or higher reasoning effort for Plan turns only. Billing estimates the cost before the run, as it already does.

---

## 5. Goals

### Model

```sql
CREATE TABLE agent_goals (
  id text PRIMARY KEY,                       -- goal_<uuid>
  owner_user_id text NOT NULL,
  conversation_id text NOT NULL,
  objective text NOT NULL,                   -- ≤ 2,000 chars
  success_criteria jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL CHECK (status IN ('pursuing','paused','achieved','unmet','budget_limited','cleared')),
  budget_weighted_tokens bigint NOT NULL,    -- the same unit as the weekly AI meter
  used_weighted_tokens bigint NOT NULL DEFAULT 0,
  continuation_count int NOT NULL DEFAULT 0,
  max_continuations int NOT NULL DEFAULT 20,
  last_report jsonb,                         -- the latest misty_update_goal payload
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agent_goals_one_active ON agent_goals (conversation_id)
  WHERE status IN ('pursuing','paused');
```

### Setting a goal

- The **Task drawer** gets a **Goal** section with Set goal, Pause, Resume and Clear.
- `/goal <objective>` in the composer.
- **From a plan:** after approval, "Set as goal" turns the plan's title and success criteria into a goal.
- The budget defaults to a share of your weekly AI meter (for example 10%) and is editable. It's shown with the existing usage ring and popover.

### Continuation loop (server-owned)

When a run finishes, Go checks:
- the conversation has a `pursuing` goal,
- the conversation is in Act mode, not Plan,
- the run ended in `success`, `incomplete` or `tool_sequence_stopped`, not `needs_input`, `canceled` or `failed` with a non-retryable error,
- the budget and `max_continuations` aren't exhausted, and the account is under its AI limit.

If all hold, Go starts a **continuation run** (`source: goal_continuation`) on the same conversation. Its prompt follows Codex's template: the objective, the success criteria, what's been done, and the budget used and remaining. The server runs this, so it survives the app closing and works across your devices.

Each continuation is admitted by billing like any other invocation.

### Completion audit

The `misty_update_goal` tool takes `{ status, evidence: [{ criterion, proof }], summary, next_steps? }`. Instructions, adapted from Codex:
- Before marking `achieved`, map each success criterion to evidence you inspected: the Note's contents, the event on the calendar, the message as sent. A tool call that "returned ok" is not proof.
- Use `unmet` for blockers you can't resolve, and say exactly what's needed. A question set also stops continuation until it's answered.

Go rejects `achieved` unless every criterion has evidence. The goal card shows that evidence so you can check it.

### Budget

- At 80% of the budget, the continuation prompt says to wrap up.
- At 100%, the status becomes `budget_limited` and the final turn is told to stop new work and summarize progress, blockers and next steps. This is a soft stop: the current turn finishes.
- **Resume** keeps the usage so far and lets you raise the budget.

### Mode interactions (made visible)

- **Plan mode:** the goal shows "Paused while planning" and continuation is suspended. Approving a plan resumes it.
- **Pending question:** "Waiting for your answer."
- **App approval card:** "Waiting for approval."
- **Paused goal:** "Paused by you."

---

## 6. Events and API summary

**New invocation event types** (`aiInvocationEvent.Type`): `question.requested`, `question.answered`, `plan.proposed`, `plan.updated`, `goal.updated`.

**New endpoints:**

| Endpoint | Purpose |
|---|---|
| `POST /me/agent-questions/{id}/answer` | Answer a question set; resumes the hook or continues the conversation |
| `POST /me/agent-plans/{id}/approve` | `{ version }`; switches the conversation to Act and starts the run |
| `POST /me/agent-plans/{id}/revise` | `{ steps }`; saves a user edit as a new version |
| `GET /me/conversations/{id}/plan` | The current plan and its step statuses |
| `PUT /me/conversations/{id}/mode` | `{ mode: "act" \| "plan" }` |
| `POST /me/conversations/{id}/goal` | Set a goal (`objective`, `success_criteria`, `budget`) |
| `PATCH /me/agent-goals/{id}` | `{ status: "paused" \| "pursuing" \| "cleared", budget? }` |

**Internal endpoints (runtime to control plane):** `POST /internal/agent-runs/{run}/questions`, `.../plan`, `.../plan-progress`, `.../goal-report`.

**Runtime:**
- New tools in `src/run-tools.ts`, alongside `misty_finish_task`.
- `src/plan-mode.ts` and `src/goal-continuation.ts` for the instruction templates.
- A `questionHook` in `src/device.ts` (rename the file to `hooks.ts`).
- `SpaceTaskContext` gains `mode`, `plan?`, `goal?` and `can_ask_user`.

---

## 7. Phases

| Phase | Scope | Size | Done when |
|---|---|---|---|
| **1. Questions** | Runtime tool and hook, Go table, API, events, wait then hand-off, question card, transcript block, superseding by typing | Medium (about 1 week) | The agent asks 1–4 questions, you answer, and the same run continues. An answer after hand-off continues the conversation. Scheduled runs never ask. |
| **2. Plan mode** | Mode control, server enforcement (catalog and gate), plan instructions, `misty_propose_plan`, plan storage and versions, plan card with Run / Keep planning / Edit, Task drawer Plan section | Medium–large (about 1.5–2 weeks) | In Plan mode no write tool is offered or executed (tested at the gate). The plan is proposed, edited and approved, then runs in Act mode. |
| **3. Live progress** | `misty_update_plan`, `plan.updated`, live checklist in the Task drawer, completion | Small (2–3 days) | The steps of an approved plan tick off live, and blocked steps show a note. |
| **4. Goals** | Table, API, Goal section, `/goal`, server continuation loop, `misty_update_goal` with the evidence check, budget soft stop, mode-interaction states | Medium (about 1–1.5 weeks) | A goal runs across several turns without you, stops when achieved (with evidence), unmet or out of budget, and stays visibly paused during planning or a pending question. |
| **5. Polish** | Planning-model setting, "Set as goal" from a plan, plan history, Global Misty panel support | Small | — |

### Tests (per phase)

- **Go:**
  - The Plan catalog filter and the execution gate reject every non-read risk.
  - Answer validation rejects unknown options, rejects double answers, and expires sets.
  - Goal continuation conditions, including budget, mode and pending-question stops.
  - The `achieved` evidence check.
- **Runtime:**
  - `misty_ask_user` suspends and resumes with answers, and hands off on timeout.
  - `misty_propose_plan` ends the turn with status `plan_proposed`.
  - Plan instructions stay in the system prompt across compaction.
- **Client:**
  - Question card keyboard flow, superseding by typing, and the hand-off continuation.
  - The plan card's actions, the edit and reorder producing a new version, and the live checklist.
- **End to end:** a "plan a weekly review Note, then do it" run that asks one question, proposes a plan, gets approved, creates the Note, and ticks all its steps.

---

## 8. Risks and open questions

- **Prompt injection in Plan mode.** Content the agent reads could try to talk it into acting. The server gate makes that harmless: write tools aren't offered and are rejected. Questions and plans are plain text with no live links.
- **Runaway goals.** The budget, `max_continuations`, the account AI limit and the evidence check bound them. We should also add a daily continuation cap per account.
- **Hook wait vs. active time.** Confirm that a suspended workflow doesn't count toward the run's active-time deadline. `space-task-agent.ts` already refreshes the deadline after durable tool waits, so this should hold.
- **Where the mode lives.** Per conversation (proposed) or per message (only `/plan`)? Per conversation matches Claude Code, Codex and Gemini.
- **Global Misty panel.** Questions in phase 1. Plan mode and goals are Agents-only until the panel has a Task drawer.
- **Naming.** "Plan" and "Act" (Cline) or "Plan" and "Build" (Cursor)? This plan assumes **Plan / Act**.

---

## Sources

- Claude Code, permission modes and plan mode: https://code.claude.com/docs/en/permission-modes
- Claude Code, common workflows ("Plan before editing"): https://code.claude.com/docs/en/common-workflows
- OpenAI Codex, Plan mode template: https://github.com/openai/codex/blob/main/codex-rs/collaboration-mode-templates/templates/plan.md
- Codex Plan mode vs `update_plan`, and `request_user_input`: https://github.com/openai/codex/discussions/11717
- Codex `/goal` mode internals (statuses, continuation, completion audit, budget): https://codex.danielvaughan.com/2026/05/03/codex-cli-goal-mode-persistent-objectives-token-budgets-agentic-loops/
- Codex `/goal` commands (pause, resume, clear): https://codex.danielvaughan.com/2026/05/07/codex-cli-goal-command-persisted-long-horizon-workflows-pause-resume-budget/
- Gemini CLI, Plan mode (read-only policy, `ask_user`, `exit_plan_mode`, model routing): https://geminicli.com/docs/cli/plan-mode/
- Cursor, Plan mode: https://cursor.com/docs/agent/plan-mode
- Cline, Plan and Act: https://docs.cline.bot/core-workflows/plan-and-act
