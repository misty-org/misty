# Workflow evals

Phase 0 of [docs/plans/agent-harness.md](../../../../../docs/plans/agent-harness.md). The browser
suite starts every task inside a tab with only browser tools, so it measures how well the agent
browses. This suite starts where a person does (the composer, the cursor or a schedule)
with the full harness, so it also measures whether the agent picked the right route:
answer directly, search, read a page in the background, use a connected app, switch to the
browser, or take over the desktop. Every run starts in `agent.tool.answer`, so an `agent_tool_use` call
in the trace shows when the agent decided it needed more.

Tasks are in `tasks.json`. Those marked `"source": "polar"` follow the knowledge work Polar's
customers describe publicly (prospect research from a sheet, ICP checks, CRM updates, candidate
sourcing, competitor monitoring, inventory and order follow-ups, scheduled runs); the rest are
Misty's own surfaces.

The tasks follow [docs/plans/agent-harness.md](../../../../../docs/plans/agent-harness.md)
revision 4: no router, `agent.tool.answer` first, teaching as answer at `agent.entry.cursor`,
screenshots of every display on every cursor request, and dotted agent names that never use
UI labels.

## Scoring

Each run records every tool call and every run started for the request. A task passes when:

- every `expect` string appears in the final answer and the judge passes every `rubric` line;
- each `tools.required` tool was called, and no `tools.forbidden` tool was (`browser_*` matches
  the family);
- tool calls are at most `tools.maxCalls` and runs at most `tools.maxRuns`.

The report keeps answer quality and routing apart, so a correct answer reached the long way
shows as a routing failure, not a pass. It also records model turns, tokens, cost and wall time
per task, and compares models side by side like the browser suite.

A relabel run repeats the suite with every UI label in the agent's glossary replaced by an
invented word (Spaces becomes, say, "Orbits", and the prompts say "my Orbit"). Routing must
score the same; a drop means a tool name, description or prompt still leans on a UI label.

Cold and warm runs measure learning. Each task's workflow signature is its category, app and
the shape of its inputs. A cold run starts with no `memory.workflow` for that signature; after a
successful run writes one, a warm run repeats the task with fresh inputs (different companies,
candidates or products, so the stored steps can't just replay an answer). The report shows each
workflow's learning curve: success, tool calls, model turns and cost, cold against warm.

## Not built yet

- The runner. It runs against the isolated live stack, never production. It starts runs
  through the control plane as each `agent.entry` does (for `surface: "cursor"`, with the
  `start.screen` fixture attached as the cursor display's capture), reads the tool trace from the
  journal, and reuses `../browser/judge.ts` and `../browser/score.ts`.
- A fixture search index so fixture tasks don't depend on live engines: `web_search` and
  `web_fetch` answer from `../browser/sites` when the runner sets it.
- Fixtures: the screen captures named under `start.screen` (`a2o-lite-neon-video.png`,
  `terminal-module-not-found.png`, `misty-settings-closed.png`, `board-on-screen.png`), the resumes under
  `fixtures/resumes/`, a `prospects` preset for `grid.html`, stock counts on `products.html`,
  bug tags and assignees on `board.html`, and shipped-order mail in `mail.html`.
- `web_fetch` itself (plan phase 1). Until it exists, tasks that require it fail; that is part
  of the baseline.
