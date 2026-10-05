# Agent work ledger

Everything still to build from the agent harness plan
([agent-harness.md](agent-harness.md)), the October 16 eval work and the Spaces
simplification ([BRIEF](../design/spaces-simplified/BRIEF.md)), checked against the code on
October 16, 2026. One row per piece of work; the order inside each section is the order to
build in. Sizes are rough: **S** is under a day, **M** is one to two days, **L** is more.

Where things stand: `main` at `0c5ece3f` (not pushed). Account tasks pass 7 of 8 on Haiku 5.5
from one run each. The full 33-task suite hasn't run since the fixes.

## 1. Evals we can trust (do first)

Every later change is judged by these, and single runs flip between pass and fail today.

| ID | Work | Where | Size |
|---|---|---|---|
| E1 | Run each task N times (default 3) and report a pass rate per task, model and category, with the spread of calls, time and cost | `evals/workflows/workflow.eval.ts`, `score.ts` | S |
| E2 | Three-model baseline: Haiku 5.5, GPT-6 Luna, Gemini Flash-Lite. Account tasks at N=3, the full suite at N=1. Budget about $2 against the $3.86 Gateway balance | runner config | S |
| E3 | Report prompt caching per run: input tokens billed at the cached rate versus full price, from the billing receipts' `cached_input_tokens` | `client.ts`, report | S |
| E4 | Cold and warm runs: the same workflow twice, comparing calls, time and cost (needs W1) | runner | S |
| E5 | Relabel run: rename UI labels in the glossary and check that the scores hold (the reason for agent names over UI labels) | runner + `agent_entry_glossary.go` | S |
| E6 | Tasks for the untested entries: `agent.entry.email`, `agent.entry.integration.slack` and voice. Today it's 27 composer, 4 cursor and 2 schedule tasks | `tasks.json` | M |
| E7 | Make calendar seeding idempotent (mail and the note already are; events duplicate on reseeding) | `seed.ts` | S |
| E8 | Fixture search index, so `research-cited-fixture` stops being skipped | `evals/workflows/` | M |
| E9 | Resume fixtures and attachment upload for `candidate-screen-rubric` | `evals/workflows/` | M |

## 2. Agent behaviour

| ID | Work | Where | Size |
|---|---|---|---|
| A1 | Scoped answers: when the person asks for a filtered set (what needs a reply, which orders), list only what meets it; anything else gets one line at most. One general rule, not a triage prompt. Fixes inbox-triage | system prompt (moves into P1 below) | S |
| A2 | Read the whole message before deciding whether an email asks for something; triage decided from previews | `integration` guidance | S |
| A3 | Re-tune the finish check from the E2 results: false refusals on chat-only drafts, missed claims | `src/finish-check.ts` | S |
| A4 | Gemini family note, from Gemini's E2 baseline runs. The current line is a guess | `src/model-family.ts` | S |

## 3. Workflow memory that works (plan P7)

`memory.workflow.learn` and `find` exist, but no run has ever called them; the lessons table
is empty. Learning must not depend on the model choosing to do it.

| ID | Work | Where | Size |
|---|---|---|---|
| W1 | Learn automatically: when a run of a saved workflow finishes "completed" (made trustworthy by the finish check), the server saves its steps as a new version, with no model call | `agent_method_tools.go`, runtime completion | M |
| W2 | Find automatically: at run start, the best-matching saved workflow's learned steps go into the context | `ai_invocation_system_prompt.go` (`methodGuidance`) | S |
| W3 | Roll back a version that scores worse in E4 | `agent_method_lessons.go` | S |
| W4 | After the second similar request with no saved workflow, offer to save it as one (decided October 16); W1 then learns on every later run. Nothing is learned silently | runtime + composer | M |

## 4. Harness architecture (plan P2–P4 leftovers)

| ID | Work | Where | Size |
|---|---|---|---|
| P1 | Prompt files per `agent.tool` and per `agent.entry` replace the 188-line Go builder. The cursor, composer, schedule and email each get a short prompt; capability text is written once per mode | `ai_invocation_system_prompt.go`, `companion_teach_prompt.txt`, new prompt files | L |
| P2 | Permission rules per `agent.tool`, and one external-effect policy for every route. Answer mode may create and edit the person's own Misty items and nothing outside Misty (decided October 16). An action that sends, posts, pays or deletes outside Misty is classified the same whether it goes through `integration_execute`, a browser click or the desktop, and follows the same rule: the person's Ask before acting and Ask before paying settings. Today an integration send shows an approval card, while the same send by browser click pauses only if Ask before acting is on (off by default). Route preference: the connected app when it can do the action, then the browser, then the desktop | `src/toolsets.ts`, `agent.gate`, app request approvals, the island pause for browser and desktop | L |
| P3 | `screen.look` and `screen.open` wait inside the run instead of ending it, so one request is one run. Needs the catalog to grow mid-run | `screen_tools.go`, `space-task-agent.ts`, desktop screen hand-off | L |
| P4 | Voice tools down to three. Today there are five (`get_context`, `get_task_status`, `cancel_task`, `start_task`, `steer_task`); the target is `ask`, `status`, `stop`, with decisions made in the run, which always has screenshots | `agent_voice_conversation*.go`, `cursorCompanionVoice.ts` | M |

## 5. Reading the web and the screen

| ID | Work | Where | Size |
|---|---|---|---|
| R1 | `browser.tab.read`: read the person's current Misty tab in the background, as a device tool, instead of opening a screen. Only `browser.tab.list` and `.open` exist today | device tools (`deviceAgentTools.ts`), Rust, `toolsets.ts` | M |
| R2 | Hidden-tab tier: pages that render only in a browser open in the agent's own hidden tab before any visible one. Pricing pages took 26 calls | Kiri page layer, `browser.*` | L |
| R3 | A search budget per run: 3 at the cursor, 6 in the composer (decided October 16). After that the agent answers from what it has or reads pages with web.fetch. Plus web.fetch caching on the device | `web_search.go`, runtime | S |
| R5 | Dev only: the dev API points web.fetch's Worker at `host.docker.internal:8790`, and that wrangler is stopped. Point dev at the deployed Worker or restart it | `server/.env/dev/integrations/web-fetch.env` | S |

## 6. Spaces, simplified ([BRIEF](../design/spaces-simplified/BRIEF.md))

Owned by the separate Spaces refactor session, not the agent engine work; listed here so nothing is lost. The Space keeps Chat, Pages, Tasks, Code and Files.

| ID | Work | Where | Size |
|---|---|---|---|
| S1 | Remove roadmaps (about 7,100 lines, 19 routes, the `roadmap.*` tools) | `src/features/planner/roadmap`, roadmap Go and routes | M |
| S2 | Remove the agenda and Misty's calendar (about 3,000 lines, `event.*` tools, calendar sources and Google links into a Space). Then remove the glossary's event line and the eval's Misty calendar check | `SpaceAgenda*`, `spaceAgenda/`, calendar Go, `agent_entry_glossary.go`, `tasks.json` | M |
| S3 | Remove the Planner wrapper; Tasks becomes its own rail tool, unchanged inside | `SpacePlanner*`, `SpaceSectionNavigation.tsx`, `navigation.ts` | S |
| S4 | Journal becomes Pages: notes and drawings in one list, each marked Doc or Canvas | journal routes, `SpaceSectionNavigation.tsx` | M |
| S5 | New Code tool: the Space's projects, their GitHub link and changes by run with the existing diffs | new `src/features/spaces/code/`, project–Space link | L |
| S6 | Remove the Smart Library's background AI (faces, auto-tags, captions, video and audio indexing, about 2,200 server lines and their env vars); uploads stop running models | `library_people*`, `media_search*`, `library_media*`, `smart_library*` | M |
| S7 | Remove Space templates | `CreateSpaceTemplateGrid`, `SaveSpaceTemplateDialog`, `spaces_space_templates.go` | S |
| S8 | Remove agent listings: agents are plain members; any member can @mention one, billed to the asker | `/agent-listings`, `AgentTeamRows`, `space_agent_listings` | M |
| S9 | Update the agent's Spaces text, which still lists "calendar, drawings, roadmaps" | `agentCapabilityGuidance` | S |
| S10 | Migration that drops the removed tables; update `roadmap.md` §1 | `server/internal/platform/postgres/migrations` | S |
| S11 | Open questions for the Spaces session: does Code show every member's projects or only linked ones; drop tables now or after production has no readers | brief | — |

## 7. Cleanup

| ID | Work | Where | Size |
|---|---|---|---|
| C1 | Prune the dead code left by the tool rename (plan P2 said "pruned after") | runtime, Go, frontend | M |
| C2 | Old words in event and audit names: `notebook.updated`, `checklist.updated`, `recall.searched`, `recall.forgotten`. They are events, not tools, so this is consistency only; rename with a migration of stored events, or leave them | Go and frontend event types | S |
| C3 | Retire `TestingDefaultAgentLowGatewayModel` naming where it is the production default (titles, dictation cleanup, day summary) | `provider_config.go` | S |

## 8. When you deploy (not now)

| ID | Work |
|---|---|
| D1 | Push `main` (`0c5ece3f` and later) |
| D2 | Add `MISTY_SERPER_API_KEY` to `server/.env/prod/integrations/ai.env`; without it production agents have no web search |
| D3 | Deploy billing (`d7ae23a`, Serper pricing) before the server |
| D4 | Production already has the web-fetch Worker's URL |

## Order

1. E1–E3 (trustworthy numbers), then A1 and A2.
2. W1–W2, then E4 and W3 (learning that pays for itself).
3. P1 and P2 (prompt files and permissions), then P3, R1 and P4.
4. S1–S10 in the Spaces session; C1 rides along with it.
5. R2–R3, E5–E9, A3–A4 and C2–C3 as the numbers call for them.

Dropped: a Brave fallback for search (decided October 16: never).
