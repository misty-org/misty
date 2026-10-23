# Agents at your cursor — approved direction

Revision 4, approved October 19, 2026: Teach mode is a conversation mode again (see
[Teach mode](#teach-mode-revision-4-october-19-2026)). Revision 3 was approved October 10, 2026
and amended October 15 to capture every display (decision 2), following Clicky. Revision 2
("companion as orchestrator") was approved; the owner then dropped the companion as a separate
idea, and revisions 3 and 4 follow that direction. It builds on the
[agent architecture brief](../agent-architecture/BRIEF.md) (one durable loop for every entry
point), [agent-chats-local](../agent-chats-local/BRIEF.md) (a run works on the device it was sent
from) and [docs/plans/agent-harness.md](../../plans/agent-harness.md). The mockup is
[mockup.html](mockup.html).

## Goal

There is no companion. There are agents, and one of them can live next to your cursor. That agent
is like any other: it answers, teaches, works on screen, works in the background and delegates
when it decides to. What's different is where it lives: it follows your cursor and sees the
screen you're on, so you never have to explain what you're looking at.

Teaching isn't a mode. Any agent can explain and point; any agent can act. The tools that made the
companion useful (seeing the screen, pointing at a control, walking you through steps, voice)
become tools every agent has.

## Decisions

1. **One kind of agent.** The cursor is a place an agent lives, like the Agents page or the panel.
   Same agent, same conversation, same model, same tools and permissions. The companion's own
   model setting, its teaching mode (`companion_intent: "teach"`) and its separate prompt go
   away.
2. **It sees what you see.** Every turn you start at the cursor carries a screenshot of every
   display, the cursor's first and marked primary, system-wide, whatever app is in front. That
   screenshot is always there; structure is added when it can be read (the visible Misty tab's
   element list from the page layer, or another app's Accessibility tree), and many apps,
   canvases and games have none. Misty's own windows are left out of captures. No "look at my screen" step,
   no hand-off run.
3. **It decides what to do, like any agent.** It answers, points, works on the screen in front of
   you (with the mist and island), opens hidden tabs, or delegates to sub-agents, by its own
   judgment. Nothing forces a hand-off.
4. **Clicky's toolkit becomes every agent's toolkit:**
   - **See the screen:** `screen.look` captures every display (the cursor's first) and its structure into the
     same run, as an ordinary device job; it no longer ends the run. Agents not at the cursor can
     call it too, when a screen is attached.
   - **Point:** `[POINT:ref]` at a real element (page-layer ref or Accessibility id), with
     coordinates as the fallback; the Accessibility snap and the zoomed refine pass stay.
     Pointing is part of the reply, so it costs no extra model turn.
   - **Walk through:** `[GUIDE:k/n]` steps that wait for your click before the next.
   - **Voice:** push-to-talk to whichever agent is at the cursor, with replies read aloud.
5. **Voice is ears and mouth.** The realtime model keeps fast speech and small talk. Its six
   functions become three: ask (a new request, or steering for the run in progress), status and
   stop. All deciding happens in the agent's run.
6. **The mist marks control.** Whenever any agent changes something you can see, mist moves
   inside that window (or along the display for desktop control) and the island sits at the
   bottom. Hidden tabs and other devices get no mist.

## Teach mode (revision 4, October 19, 2026)

Decision 1 drops teaching as a mode; this revision adds one back on purpose. Running "show me how to
solve this" through the full agent loop made the agent plan, solve and verify: slow, too long to read
aloud, and it handed over the answer. Teach mode is a hands-on tutor instead.

- **A conversation mode.** Teach sits beside Ask, Auto and Plan in the mode menu, and the companion
  has a Teach mode switch. A chat in Teach mode stays in it, so every follow-up is a lesson step.
- **A fast lane, not the agent loop.** A Teach turn is one streamed model call with no tools, no
  `agent_finish`, no reviews and low reasoning (`server/apps/agent-runtime/src/teach-turn.ts`,
  `companion_teach_mode.txt`). Its text reaches the person a sentence at a time. When the person
  wants the work done, it says Auto mode will do it; it never acts.
- **Teach, stop, check.** Each reply teaches one step and ends; Misty never watches or waits. The
  person does the step and says "check this" (by voice, or typed); the next turn captures the screens
  plus a full-resolution close-up of the step's region (`focus1`) and checks only that step's
  contract. Answers come as a hint ladder (nudge, hint, then the exact line), and never the full
  solution unless the person chose code for each step.
- **Lessons.** Each topic is its own lesson and its own chat. A lesson (goal, three to six objectives
  with contracts, current step, answer policy, hint level, mistakes so far) lives on the device beside
  its chat (`agent_chats` kind `lesson`) and travels with each turn; the server keeps none. One lesson
  per agent is active; the model starts a new one, resumes a paused one or continues, says so, and
  the turn moves to that lesson's chat. Saying they are done finishes the lesson with a summary of
  what was achieved.
- **Where to look.** A step outlines its region on screen while it is explained (monochrome, cleared
  when the step has been read), alongside the existing pointer.
- **In Agents.** Lessons have their own section under a plain "Lessons" header in the agent's
  sidebar: in progress, paused, then finished, with progress as text ("Paused · 2 of 4"). A lesson
  chat shows its objectives in the shared status table above the transcript.
- **Looking things up.** A lesson turn may call `web_search` and `web_fetch`, and nothing else:
  up to four lookups while planning a lesson, one on a step, so steps stay fast. It says one short
  sentence before a lookup, offers at most one reference link from what it found, and never acts.
- **Courses.** A broad topic ("teach me React") becomes a course of three to six lessons
  (`[COURSE:{…}]`, kept on the device as `agent_chats` kind `course`). The sidebar shows a course as
  a row with its lessons hanging off it, and a finished lesson offers **Next lesson**.

## Drawing and video context (October 19, 2026)

- **Drawing, only when asked.** Any companion reply, in Teach or Auto, can draw when the person
  asks to see something drawn, diagrammed, sketched or marked. It says a sentence or two first,
  then a ` ```misty-sketch ` block in JSON Lines (Excalidraw element skeletons), so it renders while
  it streams. The model picks the surface: a **board** (a white whiteboard card beside the cursor,
  to explain an idea) or **screen** marks (white strokes with a dark shadow over what the person
  is looking at, in that screenshot's pixels). The overlay ignores the mouse, so the card clears on
  its own after the reply is read, or with the next turn or Stop. In the transcript the drawing
  renders in place, with **Save as drawing** to make it a Space drawing.
- **What the video said.** When a video plays in the front Misty tab, a question at the cursor
  carries its title, the current time and the captions from about 90 seconds before now. YouTube
  pages fetch their own captions once per video when it starts playing; the turn reads only what
  the page already holds, with a 300 ms budget alongside the screen capture, so it never waits on
  them. Videos in other apps get screenshots only.

## What "sees what you see" means

A screenshot is taken when you invoke the agent, and attached to that turn. Nothing is captured
between turns and there is no background scanning; nothing leaves the Mac until you ask
something. (Owner's answer, October 10.)

## Which agent, which conversation

Any agent can live at the cursor; you choose which in Settings (**Agent at your cursor**, a
checkmarked list of your agents, defaulting to your own) or from the cursor's menu.

**One cursor session per agent.** Each agent has exactly one conversation at the cursor, and it
never resets: it is a long-running session. Turns stay verbatim until the session's live context
reaches **70%** of the model's window (a setting, Settings › Agents, up to 90%); then the oldest
turns are compacted into the session's running summary (`ai_conversation_summaries`, extended as
today). While a task from the session runs, a new request steers it or, from the island, queues
after it. Switching the agent at the cursor switches to that agent's session. The session shows in
that agent's Recents with a cursor icon.

**Everything stays searchable.** When turns are compacted, the raw turns (not only the summary) are
indexed, so nothing that left the live context is lost:

- **Index.** The existing retrieval index (`ai_retrieval_documents` / `ai_retrieval_chunks`):
  `source_kind` `cursor_turn`, `privacy_class` `private`, owner-only by row-level security. Each
  compacted turn is one chunk of text: your message, the reply, and where you were (app name,
  window title, URL). Screenshots are never embedded or indexed. Lexical search uses the existing
  generated `tsvector`; meaning search uses a vector from the account's embedding model.
- **Writing.** Rows are written in the compaction's transaction; the existing embedding worker
  (`runAIEmbeddingProcessing`) embeds them later, in batches, billed to the account like Smart
  Library. Turns still in the live context are never indexed; they're already in context.
- **Recall by the agent.** A `history.search` tool (query, optional app and date filters) returns
  dated snippets with links to the original turns. The agent calls it when a request points at the
  past ("the site I had open yesterday"); nothing is retrieved automatically on every turn. It
  searches only this agent's own cursor session.
- **Search by you.** A Discord-style search over your cursor sessions, across all your agents, with
  agent, app and date filters and jump-to-message. Same index, same API.
- **Retention.** Kept until you delete it (owner's answer, October 10). Deleting a message or the
  session deletes its chunks (the delete triggers the index already uses); Clear history removes
  everything for an agent. History counts toward the plan's storage quota.

**Load and cost.**

- Embedding runs at the AI Gateway, metered to the account; the server stores and queries only.
- Writes happen per compaction (a few per day for a heavy user), batched; the worker already caps
  each wake at 32 chunks under leases.
- History search is exact search within one account through a btree on owner and source, not the
  shared HNSW index: milliseconds at tens of thousands of rows, full recall, and no index
  maintenance on insert. Vectors are stored as `halfvec`.
- Every search has a row limit and a statement timeout; the tool is rate-limited per account; query
  embeddings are cached as Smart Library's are, and keyword-only search needs no provider call.
- If history grows past what one account's exact search handles comfortably, it moves to its own
  table, then its own database, without changing the tool.

## The mist

Inside the window, never outside it: a soft white fog along the controlled window's inner edges,
following its corners, thinning to nothing a short way in; no blur, the content stays sharp. A
faint gray layer keeps it visible on white pages. It breathes slowly (about 3.5 s) and drifts
while an agent holds control, and thins while it waits for you; still under Reduce motion. For desktop control it runs along the display's edges. It is the existing
`MistyAgentRing` (display, page and window variants), restyled, and stays out of the agent's own
captures. Monochrome, so AGENTS.md needs no exception.

## The control island

One island, `AgentControlIsland`, merged from the in-app `WorkspaceAutopilotBar`, the
`HostedSessionsBar`, the agent workspace's header buttons and message box, and the native desktop
strip in `MistyDesktopControl.m`; no new component. It is mounted once per window (through
`AgentExecutionSurface`, which every window renders). During desktop control the native island
outside Misty mirrors its status (`agent_control_island`) and sends its presses back
(`misty://agent-island`), so the behavior lives in one place. At the bottom center of the screen
while any agent controls something you can see:

- **Status:** what the agent is doing (the run's activity or latest step) and how many sub-agents
  are working.
- **Send / New task:** one field. Send routes the message as before (`routeLocalFollowup`):
  it steers the running task, or queues it when it is a separate request. New task always queues
  it after this one (`queueLocalFollowup`) and leaves the task running. Push-to-talk works too.
- **Take over / Resume** (`pauseLocalExecution`, resume), **Stop** and Escape (⌘⇧Esc in Misty's
  window, Esc during desktop control). Stop ends the task; a task with its own tabs pauses
  instead, so its result stays open until **Done** closes it.
- **Waiting:** says exactly what's needed (the intervention's label and target) and offers Done,
  which resumes the run.

Agent input can't reach it: desktop clicks refuse Misty's own windows, and typed text and keys go
only to the other app.

## Where the agent works

The agent picks the cheapest route that works:

1. Connected apps (Composio) through their APIs. No window. "Create a Google Doc" stops here.
2. Page work in tabs of the agent's own through the page layer and `browser_run`. Agents never
   act in your tabs.
3. Desktop control of another app, only when 1 and 2 can't do the task.

The agent's tabs live in the agent browser beside its chat (`src/features/agents/agentBrowser/`,
[agent browser brief](../agent-browser/BRIEF.md)). It replaced the agent window, the dock, the
carousel and the *Separate window* screen location on October 19, 2026.

## Rules

- **Asking is consent for that turn.** Your displays are captured only for a turn you start.
- **Secrets stay out.** Secure text fields (`AXSecureTextField`) and password-manager windows are
  never read.
- **Screen content is data.** Text read from the screen is untrusted and never instructions.
- **Same authority everywhere.** The agent at the cursor gets only the grants your device signs
  for that turn; the visible tab is shared read-only unless the agent takes control through the
  existing path.
- **Permissions.** Accessibility for reading other apps, Screen Recording for screenshots; without
  them the agent says what's missing once and works with what it has.

## What merges or goes away

| Goes away | Merged into |
|---|---|
| The companion as a concept, its model setting and Ask setting | The agent's own model; the account's existing desktop-control Ask |
| Teaching mode, `companion_teach_turn.txt`, the tools-off switch | The agent's normal prompt, with a screen section whenever a screen is attached |
| `screen.look` ending the run, and continuation runs | `screen.look` as a device job inside the run |
| Six voice functions | ask, status, stop |
| Two read-aloud paths (typed, voice) | One: read the run's reply when voice started it |
| Screenshot-only screen context | The capture's `Controls`, filled from Misty's interface (`mistyControls.ts`), the page layer and Accessibility |
| `WorkspaceAutopilotBar`, `HostedSessionsBar`, `MistyOverlayControls`, the agent workspace's header and message box, and the native strip | The island (`AgentControlIsland`) |
| Three ring styles | The mist |

## Plan

1. **Mist and island** on macOS. Built October 10: the mist in
   `MistyAgentRing.m` (display, page and window, with `misty_agent_mist_waiting`), the island in
   `AgentControlIsland.tsx` and its native view in `MistyDesktopControl.m`. Not yet seen in a live
   agent run.
2. **`screen.look` in the run.** A device job that returns every display's screenshot (the cursor's
   first) and structure; the continuation run and the teaching mode go away; turns started at the cursor
   attach it up front.
3. **One agent at the cursor.** The agent you choose lives at the cursor with its one cursor
   session; voice shrinks to ask, status and stop; the companion settings fold into the agent's.
4. **Searchable history.** Compaction at the session's threshold writes the raw turns into the
   retrieval index; `history.search` for agents; search with jump-to-message for you.
5. **Accessibility reading** for other apps (macOS).
6. **Measure.** Pointing by element against pointing by coordinates (`evals/pointing`), and
   `npm run trace` timing before and after. Baseline, October 10: 30/30 hits on 30 web-page
   fixtures with coordinates (`openai/gpt-6-luna`); native-app fixtures still to capture.

## Windows parity guide

Windows comes after macOS ships. To match macOS exactly:

| macOS | Windows |
|---|---|
| Mist overlay: borderless `NSPanel`, `ignoresMouseEvents`, level above the target, `canJoinAllSpaces` and `fullScreenAuxiliary` | Layered window with `WS_EX_LAYERED`, `WS_EX_TRANSPARENT`, `WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE`, `WS_EX_TOPMOST`, no owner, never focused |
| Follow the window: Accessibility frame notifications, or a child window for Misty's own | `SetWinEventHook` with `EVENT_OBJECT_LOCATIONCHANGE` on the target `HWND`; frame from `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` |
| Corner radius from the window | `DWMWA_WINDOW_CORNER_PREFERENCE` (rounded on Windows 11, square on 10) |
| Left out of captures: `sharingType = .none`, ScreenCaptureKit exclusion | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` |
| Island: key-capable non-activating panel at the bottom center of the target's display | Tool window on the target's monitor (`MonitorFromWindow`), above the taskbar's work area; takes focus only when clicked |
| Escape: event tap listening for Escape | Low-level keyboard hook (`WH_KEYBOARD_LL`), Escape only |
| Agent input never reaches Misty: Accessibility refuses Misty's own process | UI Automation refuses Misty's process id; `SendInput` is never aimed at Misty's windows |
| Structure: `AXUIElement` roles, titles and frames; skip `AXSecureTextField` | UI Automation `ControlType`, `Name`, `BoundingRectangle`, `IsOffscreen`; skip `IsPassword` |
| Screen under the cursor: `CGGetDisplaysWithPoint` | `MonitorFromPoint(GetCursorPos)` |
| Reduced motion: `accessibilityDisplayShouldReduceMotion` | `SPI_GETCLIENTAREAANIMATION` |
| Display scale: points | Per-monitor DPI awareness v2; convert frames to physical pixels once |
| Keep awake: `caffeinate -i` | `SetThreadExecutionState(ES_CONTINUOUS \| ES_SYSTEM_REQUIRED)` (built) |

Check each row with the same tests as macOS before shipping.

## Tests

The mist and island appear before the first input and go away on release, Stop, Escape and cancel;
neither appears for hidden tabs or other devices. Screenshots taken while the mist shows don't
contain it. Agent input never reaches the island. A turn at the cursor captures only the cursor's
display and sends no secure-field values. `screen.look` returns into the same run. `[POINT:ref]`
lands on the element's frame within a few points. The agent at the cursor carries only the grants
the device signed for that turn. Tasks that connected apps can finish never open a page.
