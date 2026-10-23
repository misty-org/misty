# Agents

Misty's agents work in your browser, on your computer, signed in as you, while you watch.
The model loop runs on the server runtime (`server/apps/agent-runtime`), every model call
goes through its AI SDK on Misty's keys, and the pages are read and driven by the desktop app.
Chats live on the device that started them.

## Read first

| To learn about | Read |
| --- | --- |
| How the agent works today: loop, tools, what the model sees, how a run ends | [harness.md](harness.md) |
| The approved architecture and its security invariants | [architecture.md](architecture.md) |
| The agent browser beside a chat | [browser.md](browser.md) |
| Where chats are stored and why | [chats-local.md](chats-local.md) |
| The agent at your cursor, push-to-talk, Teach mode | [cursor-companion.md](cursor-companion.md) |
| Resuming a run without redoing finished work | [checkpoints.md](checkpoints.md) |
| Delegating code to installed coding tools | [coding-tools.md](coding-tools.md) |
| Benchmarks: the Odysseys campaign and running evals without paid credit | [evals/odysseys.md](evals/odysseys.md), [evals/free-model.md](evals/free-model.md) |
| Mockups (agent chat, cursor companion) | [mockups/](mockups/) |

In flight: [agent browser actions](../plans/agent-browser-actions.md). Code lives in
`src/features/agents/` (see its `DESIGN.md`), `server/apps/agent-runtime/` and
`src-tauri/src/infra/browser/page_agent/`.

## Interface rules

- Exception: status dots on agent conversation rows (the Agents sidebar Recents) follow Claude's session list: gray at rest, pulsing while queued or working, amber when the run needs the user, red when it failed, using the `--misty-status-*` tokens in `src/styles/App.css`. A settled run's dot is filled until its conversation is read on this device (chats live on the device that started them, `docs/agents/chats-local.md`) and a hollow gray ring afterwards, meaning nothing new. Every dot keeps a text label (tooltip and screen reader). Do not spread status color to other surfaces.

- Exception: diffs (`src/features/agents/components/changes/`) tint added lines green and removed lines red, like Claude Code and Codex, with matching +/− counts. The tint marks the line's change, never state; file headers, buttons, selection and focus stay monochrome, and other surfaces don't borrow these colors.

- Exception: agent conversations (`src/features/agents/`, the control island, the cursor companion panel) follow `docs/agents/mockups/chat.html` (the mockup) and the rules below. Every list of steps (checklist, sub-agents, plan, app and screen requests, unfinished work) is the shared `StatusTable` from `progress/StatusTable.tsx`: a status icon, a status word, the thing itself and a short result. Working text shimmers. Status icons are allowed; amber marks "waiting for you", red marks "failed" and a soft green marks "done" (`--misty-status-*`), always with the word beside them. Connected apps show their `BrandIcon` logo. Actions are real buttons (primary for the one that moves things forward), never underlined links. The final answer is plain formatted text in the transcript, never a banner, toast or error popup; a run that did not finish shows its answer and a "Not finished" table, and a failure shows as a table row where it happened.

- Teach mode (`src/features/agents/lessons/`, `docs/agents/cursor-companion.md` revision 4) is a conversation mode beside Ask, Auto and Plan and a companion switch. Its turns run the tutor's fast lane, never the agent loop. Lessons have their own section in the agent sidebar under a plain "Lessons" header, rows hanging off it with `TreeBranch`, status and progress as text. A lesson's objectives use the shared `StatusTable`; a course is a row with its lessons hanging off it. The companion's focus outline is monochrome.

- Companion drawings (`src/features/agents/companion/companionSketch.ts`) stay monochrome: the whiteboard is a white card with near-black hand-drawn strokes in both themes, and screen marks are white strokes with a dark shadow. They appear only when the person asks for a drawing, and the transcript shows the drawing itself, never its source.

- Exception: the agent browser beside a chat (`src/features/agents/agentBrowser/`) is a small browser of its own with a horizontal tab strip above its toolbar row and page. The window's tabs stay in the sidebar.

