# Agents

Misty's agents work in your browser, on your computer, signed in as you, while you watch.
The model loop runs in the agent runtime inside the app on that computer (`src-tauri/crates/agent`),
and every model call goes through its own model clients on that computer's own models and keys. The server never calls a model or holds a key. Conversations are stored on the
server, per person per Space.

## Where conversations live

Approved November 4, 2026. This replaces keeping chats on the computer that started them.

- **On the server, per person per Space.** Each conversation has one Space for its whole life:
  a new one goes to the window's current Space. Its turns (`ai_invocations`, whose request holds
  the prompt), their events (`ai_invocation_events`: replies, the timeline, sources, notebook,
  sub-agents), tool output (`misty_ask_conversation_events`, as `tool_result`) and folders and read
  state are all there. Nothing here is encrypted.
- **Always private to their owner.** Row security and the queries both limit a conversation to the
  person who started it. Nobody else in its Space can list or read it, the Space's owner included.
- **Tool output is kept.** Each finished call's output is stored, up to 256 KiB. Screenshots go to
  the object store where Library files live (`ai_conversation_attachments`, scope `tool_output`), and
  the stored output names them. They aren't offered to the model as attachments.
- **What's never stored.** Model keys and search keys, which never reach the server. A result marked
  redacted, such as a connected app's, stays sealed: only that the call happened is stored. Fields
  named like a credential are replaced before storing.
- **What that means.** What an agent reads on a signed-in page is stored on the server and readable
  by whoever runs it, and sits in backups for up to 30 days after deletion. The vault's guarantee
  doesn't extend to it. Get started says so where someone first uses agents.
- **Retention.** Settings › Agents › Conversation retention governs it. A conversation with no
  activity for that long is deleted with everything stored for it, and older turns, tool output and
  screenshots go from conversations still in use (`PurgeExpiredAgentConversations`,
  `PurgeExpiredAITransients`).
- **Any signed-in session can read and continue one.** A run still works on the computer it was sent
  from (`runtime_endpoint` is pinned at admission), so continuing from another computer runs there.
- **A run names its Space and its profile,** and uses that profile's sign-ins in the window it
  started from. A schedule chooses its profile when it's made (`workflow_schedules.profile`, the first
  profile by default). A computer without that profile can't claim the run, and the schedule says why.
- **Choosing a Space changes what a window shows and where new conversations go,** never tabs. Each
  window remembers its own (`spaceWindow.ts`), and the list comes from the server across all Spaces.
- **Leaving a Space takes your conversations in it,** like the rest of your private layer there, and
  touches no browsing data.

## Read first

| To learn about | Read |
| --- | --- |
| How the agent works today: loop, tools, what the model sees, how a run ends | [harness.md](harness.md) |
| Where the runtime runs, how runs reach it, model calls on the computer | [runtime.md](runtime.md) |
| The approved architecture and its security invariants | [architecture.md](architecture.md) |
| The agent browser beside a chat | [browser.md](browser.md) |
| The agent at your cursor, push-to-talk, Teach mode | [cursor-companion.md](cursor-companion.md) |
| Resuming a run without redoing finished work | [checkpoints.md](checkpoints.md) |
| Benchmarks: running Odysseys and comparing runtimes, and the campaign that ended October 31, 2026 | [evals/odysseys.md](evals/odysseys.md) |
| Mockups (agent chat, cursor companion) | [mockups/](mockups/) |

In flight: [agent browser actions](../plans/agent-browser-actions.md). Code lives in
`src/features/agents/` (see its `DESIGN.md`), `src-tauri/crates/agent/` and
`src-tauri/src/infra/browser/page_agent/`.

## Interface rules

- Exception: status dots on agent conversation rows (the Agents sidebar Recents) follow Claude's session list: gray at rest, pulsing while queued or working, amber when the run needs the user, red when it failed, using the `--misty-status-*` tokens in `src/styles/App.css`. A settled run's dot is filled until its conversation is read, in any signed-in session, and a hollow gray ring afterwards, meaning nothing new. Every dot keeps a text label (tooltip and screen reader). Do not spread status color to other surfaces.

- Exception: agent conversations (`src/features/agents/`, the control island, the cursor companion panel) follow `docs/agents/mockups/chat.html` (the mockup) and the rules below. Every list of steps (checklist, sub-agents, plan, app and screen requests, unfinished work) is the shared `StatusTable` from `progress/StatusTable.tsx`: a status icon, a status word, the thing itself and a short result. Working text shimmers. Status icons are allowed; amber marks "waiting for you", red marks "failed" and a soft green marks "done" (`--misty-status-*`), always with the word beside them. Connected apps show their `BrandIcon` logo. Actions are real buttons (primary for the one that moves things forward), never underlined links. The final answer is plain formatted text in the transcript, never a banner, toast or error popup; a run that did not finish shows its answer and a "Not finished" table, and a failure shows as a table row where it happened.

- Teach mode (`src/features/agents/lessons/`, `docs/agents/cursor-companion.md` revision 4) is a conversation mode beside Ask, Auto and Plan and a companion switch. Its turns run the tutor's fast lane, never the agent loop. Lessons have their own section in the agent sidebar under a plain "Lessons" header, rows hanging off it with `TreeBranch`, status and progress as text. A lesson's objectives use the shared `StatusTable`; a course is a row with its lessons hanging off it. The companion's focus outline is monochrome.

- Companion drawings (`src/features/agents/companion/companionSketch.ts`) stay monochrome: the whiteboard is a white card with near-black hand-drawn strokes in both themes, and screen marks are white strokes with a dark shadow. They appear only when the person asks for a drawing, and the transcript shows the drawing itself, never its source.

- Exception: the agent browser beside a chat (`src/features/agents/agentBrowser/`) is a small browser of its own with a horizontal tab strip above its toolbar row and page. The window's tabs stay in the sidebar.

