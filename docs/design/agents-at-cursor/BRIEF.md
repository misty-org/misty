# Agents at your cursor — approved direction

Revision 3, approved October 10, 2026. Revision 2 ("companion as orchestrator") was approved; the
owner then dropped the companion as a separate idea, and this revision follows that direction. It builds on the [agent architecture brief](../agent-architecture/BRIEF.md)
(one durable loop for every entry point), the
[agents-on-devices brief](../agents-on-devices/BRIEF.md) and Phase 4 of
[docs/plans/agentic-browser.md](../../plans/agentic-browser.md). The mockup is
[mockup.html](mockup.html). The agent window (take over, detach, dock) is in
[agent-window-mockup.html](agent-window-mockup.html).

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
2. **It sees what you see, one screen at a time.** Every turn you start at the cursor carries a
   screenshot of the display your cursor is on, system-wide, whatever app is in front. That
   screenshot is always there; structure is added when it can be read (the visible Misty tab's
   element list from the page layer, or another app's Accessibility tree), and many apps,
   canvases and games have none. Other displays are not captured. No "look at my screen" step,
   no hand-off run.
3. **It decides what to do, like any agent.** It answers, points, works on the screen in front of
   you (with the mist and island), opens hidden tabs, or delegates to sub-agents, by its own
   judgment. Nothing forces a hand-off.
4. **Clicky's toolkit becomes every agent's toolkit:**
   - **See the screen:** `screen.look` captures the cursor's display and its structure into the
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
- **Detach / Dock** (see the next section): Detach sends the agent's tab to its own docked
  window, with Show and Bring back while it's away; Dock shrinks an opened agent window back to its
  corner.
- **Take over / Resume** (`pauseLocalExecution`, resume), **Stop** and Escape (⌘⇧Esc in Misty's
  window, Esc during desktop control). Stop ends the task; a task with its own tabs pauses
  instead, so its result stays open until **Done** closes it.
- **Waiting:** says exactly what's needed (the intervention's label and target) and offers Done,
  which resumes the run.
- **No task here:** a quiet line for each agent working on this computer for another of your
  devices, with Stop.

Agent input can't reach it: desktop clicks refuse Misty's own windows, and typed text and keys go
only to the other app.

## Taking over the app: the agent window

Approved October 10 from [agent-window-mockup.html](agent-window-mockup.html); built October 11
(uncommitted, not yet run in a live task).

**When.** The agent picks the cheapest route that works, and the setting never forces one:

1. Connected apps (Composio) through their APIs. No window. "Create a Google Doc" stops here.
2. Structured page work in a Misty tab through the page layer. The tab is yours if you started
   from the browser panel, otherwise one the agent opens for itself, hidden.
3. **Takeover**: the agent drives a whole Misty window like a person, with tabs, canvases,
   pasting, dragging between apps (`browser.workspace.visual` / `.interact` and Midscene). Only
   when 1 and 2 can't do the task, such as drawing in Excalidraw or pasting an image.

**Where.** The existing Settings › Agents › **Where Misty opens new screens** is this choice; no
second setting. *New tab* works in your window; *Separate window* gives the agent its own window
(`agent_window_open`), which docks the moment it opens, so the window you're in never changes.

**Detach.** Misty has one app window, so Detach moves the agent's tab rather than the window: the
page leaves your window, live and unreloaded, for a window of its own (`misty-dock-<uuid>`) that
docks in the corner. The task keeps running in your window, so its lease, scopes and grants don't
change. Your tab shows a short notice with **Show** and **Bring back**; the tab comes home when
the task ends, when you press Bring back, or when you close the agent's window. While it is away,
your window never hides, moves or resizes it (`browser.rs` checks the caller's window).

**The docked window.** Like a video in picture in picture on iPhone:

- Small (288 points wide, the content's own aspect) in a corner of Misty's window, which it moves
  with; it never floats over other apps (owner's choice, October 11, like Codex). The mist shows inside it while the agent acts; a
  small pill floating 8 points in from the bottom and side edges says what it's doing, or what it needs, with an icon, never a
  color. Hover puts Open and Stop inside the pill, before the count.
- Drag it anywhere; it snaps to the nearest corner. Drop it by a side edge and it floats there,
  whole and on screen, a few points in. It is never tucked off-screen.
- Click it to open the agent's window at full size in front; **Dock** on the island (or the bar
  of a detached tab's window) shrinks it back. Hover shows Open and Stop; Stop ends the task like
  the island's Stop.
- **Several takeovers** overlap into one stack, each offset inward and slightly smaller, with a
  count. Up to five fan out fully; more compress the fan so every window keeps a strip showing.
  An agent that starts waiting for you moves to the front.
- **Carousel.** Clicking the stack fans it out: the chosen window in the middle, the others
  smaller and dimmed to either side, animated. Scroll, the arrows or the arrow keys move between
  agents; the label under it follows the chosen agent's step live. Clicking the middle window
  opens it; Escape or a click elsewhere folds the stack back with the chosen one in front. Reduce
  motion turns the animation into a cut. Real windows can't tilt, so the mockup's 3D turn is a
  flat slide.

**Never stop WebKit.** The docked window is the agent's real window, a child of Misty's window.
Its content view keeps its bounds at the full size the page was laid out for while its frame
shrinks (`MistyAgentDock.m`), so pages never relayout and the agent's snapshots
(`takeSnapshotWithConfiguration`) stay full resolution. A covered window would normally make
WebKit stop painting and slow timers to one a second (measured October 11), so:

- Pages in an agent's window turn off WebKit's covered-window detection (the private
  `_setWindowOcclusionDetectionEnabled:`) from docking until the tab returns to your window.
- When Misty hides or its window minimizes, docked windows stay on screen, transparent and
  click-through, and come back with Misty. Nothing pulls Misty in front of other apps.
- `agent_dock_visibility` reports each docked window's state for checks.

What it can't prevent: a locked screen or a display that turns off. If a future macOS drops the
private setting, covered pages throttle again rather than break.

**Checked October 11** through the eval bridge's `/dock` route (debug builds): Excalidraw and a
Google Doc docked alone, at the front, middle and back of a stack of three, at the middle and
sides of the carousel, opened and docked again, with Misty covered by another window, hidden and
minimized, and opened full size while covered. In every state the page kept its 1280 × 860 layout,
`visibilityState` stayed `visible`, animation frames ran at 60 per second, timers ran as in the
Misty window, snapshots stayed full resolution and macOS reported every docked window visible.
While docked, a native drag drew a rectangle in Excalidraw, a pasted image landed on its canvas,
and native typing in the doc was saved (read back through Docs' export).

**App commands.** Under takeover, opening and switching tabs and windows are one structured tool
over the app's own commands (new tab, new window, switch tab, close tab, as
`useBrowserMenuCommands` dispatches them), not clicks on the tab strip.

## Rules

- **Asking is consent for that turn.** The cursor's screen is captured only for a turn you start,
  and only that display.
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
| Capturing every display | The cursor's display only |
| Six voice functions | ask, status, stop |
| Two read-aloud paths (typed, voice) | One: read the run's reply when voice started it |
| Screenshot-only screen context | The capture's `Controls`, filled from Misty's interface (`mistyControls.ts`), the page layer and Accessibility |
| `WorkspaceAutopilotBar`, `HostedSessionsBar`, `MistyOverlayControls`, the agent workspace's header and message box, and the native strip | The island (`AgentControlIsland`) |
| Three ring styles | The mist |

## Plan

1. **Mist and island** on macOS. Built October 10, uncommitted: the mist in
   `MistyAgentRing.m` (display, page and window, with `misty_agent_mist_waiting`), the island in
   `AgentControlIsland.tsx` and its native view in `MistyDesktopControl.m`. Not yet seen in a live
   agent run.
2. **`screen.look` in the run.** A device job that returns the cursor display's screenshot and
   structure; the continuation run and the teaching mode go away; turns started at the cursor
   attach it up front.
3. **One agent at the cursor.** The agent you choose lives at the cursor with its one cursor
   session; voice shrinks to ask, status and stop; the companion settings fold into the agent's.
4. **Searchable history.** Compaction at the session's threshold writes the raw turns into the
   retrieval index; `history.search` for agents; search with jump-to-message for you.
5. **Accessibility reading** for other apps (macOS).
6. **Measure.** Pointing by element against pointing by coordinates (`evals/pointing`), and
   `npm run trace` timing before and after. Baseline, October 10: 30/30 hits on 30 web-page
   fixtures with coordinates (`openai/gpt-6-luna`); native-app fixtures still to capture.
7. **Agent window.** Built October 11, uncommitted: the dock (`MistyAgentDock.m`,
   `agent_dock.rs`), Detach, Show, Bring back and Dock on the island, the detached tab's window
   and notice. The Excalidraw and Google Docs check passed October 11. Still to do: the app-command tool.

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
the device signed for that turn. Detach keeps the run's lease and scopes on the agent's window and
the run continues uninterrupted; a docked window's page keeps its full-size layout and its
snapshots stay full resolution; tasks that connected apps can finish never take over a window.
