# Misty as a workspace for agents

Written 2026-11-10. Delete each phase when it is done, and this file when all of them are.

Misty stops being a browser for people and becomes a workspace where a person's agents work
inside Spaces. The interface and the attention change; almost all the code stays.

## Decided

- **Any engine.** The main chat runs outside agent engines (Claude Code, Codex and others), ported
  from [desktop-cc-gui](https://github.com/zhukunpenglinyutong/desktop-cc-gui) (MIT). Its code is
  copied in and credited, not added as a dependency.
- **Everything is an adapter.** Misty doesn't compete with OpenCode, ccgui, Hermes3D or
  OpenChamber; it takes in what they have. Each engine comes in the same way, as an adapter, and a
  person picks the adapter they want. OpenCode is ported from ccgui's adapter like the others,
  not run through its own server.
- **OpenChamber is the model for the chat view** and its side tools
  ([openchamber/openchamber](https://github.com/openchamber/openchamber), MIT, checked
  2026-11-10): its layout and how it works, drawn in black, white and gray. The sidebar stays as
  built. The separate OpenChamber Launcher is reported to be GPL-3.0; take no code from it.
- **Misty's own runtime stays** for browser work and Space work. Nobody has to use it.
- **The built-in browser is for agents.** A person can watch a page an agent is using and take it
  over (to sign in, pass a check, or steer). There is no tab list of web pages, address bar,
  favorites or history as the main interface.
- **The sidebar is a Space navigator**: the Space's pages at the top, then the person's chats under
  each agent. It lists no tabs. Split panes stay as the container for views.
- **Views over one Space**: home, chat, and later virtual (2D and 3D), all showing the same agents.
- **Agents belong to the person.** They are saved on the computer, placed into Spaces, and take
  requests only from their owner. In a shared Space they see each other's status and hand work
  over through people (phase 1b); nobody calls someone else's agent.
- **Folders are linked to a Space** on each computer. Engines run in those folders. The link is a
  device setting and never syncs.
- **Engines reach a Space two ways**: direct tools for notes, files and threads, and one "ask
  Misty" tool that hands browser work to Misty's own agent.
- **Coding panels that come across**: file tree and editor, terminal, Git panel. Not ccgui's plugin
  system.
- **Self-hosting stays** next to Misty's hosted server.

## The Space is the universal adapter

Added 2026-11-11. The platform isn't the problem; what is missing is one place every agent can
work from. A person should be free to use whatever AI they want, and context belongs to the
Space, not to a vendor: someone using Codex and Claude has both in the same Space, with nothing
to import.

Decided:

- **Spaces live only on a server**, never in the desktop app.
- **Misty Cloud** is where most people start and share Spaces: Free with small limits, with Pro
  as the upgrade. **Self-hosting is free and complete**, mostly for developers. Only
  `misty-cloud` (billing) stays private.

Proposed, not yet confirmed:

- **Agents share artifacts, not transcripts.** Each engine's chat history stays in its own files.
  Agents save files, notes, decisions and where they left off to the Space with provenance
  (`agents/artifacts/agentArtifacts.ts`), and whoever picks up next, on any engine, starts there.
- **Memory is shared across engines** through the existing encrypted vault.
- **The Space MCP server becomes an open, documented interface**, so agents Misty doesn't start
  (Cursor, the Claude desktop app) can join a Space too. Today `engines/mcp.rs` gives a token
  only to a run Misty started.
- **End-to-end encryption for Space content** may need to move up: only the vault is protected
  from the server today.

Work this creates:

- **Several servers in one app.** `src/api/deployment/serverChoice.ts` keeps one server per
  device, so a self-hosted server and friends' Spaces on Misty Cloud can't be used together. It
  also still names the address `mistyProServer()`.
- **Moving a Space between servers** (notes, files, library, history). Without it "portable"
  isn't true.
- **A plain local mode for `misty-server`**, lower priority: files on disk, no tunnel, and
  `docker compose up` working first time.
- **Free limits** on what costs money: storage, shared Spaces, members and history kept, with
  per-file and per-account caps. Inactive free accounts are never deleted, so the caps matter.
- **A mismatch in `misty-cloud`**: it closes and deletes a cancelled account after 30 days, while
  `AGENTS.md` says the account moves to Free.

## Decisions of 2026-11-11 (night)

- **Interface quality comes first.** The interface today is unpolished. Model it on OpenChamber
  (and OpenHands): floating bars and panels, generous spacing, rounded cards. A little color is
  welcome where it carries meaning (Git changes, file and folder icons); the virtual office may
  use full color. `AGENTS.md` still states the old gray-only rule and must be brought in line.
- **The office is a Sims-like world**, built ourselves after Hermes3D in Misty's look: characters
  that walk around, furnished rooms, a card for the picked agent with actions, and a build mode.
  The first 2D/3D office is far below this and is to be replaced.
- **Phase 6 is confirmed**: delete everything listed there, checking first what agents share.
- **Handoffs**: the agent drafts on the person's computer and the person sends it, so nothing a
  model wrote reaches the server unapproved.
- **The Space MCP server opens** to agents Misty doesn't start.
- **Order**: prove what exists (look at the app, real Codex and Claude Code turns), then the
  missing features. At most three large commits, not pushed.

## After the night of 2026-11-11

Proven in the running app: Codex end to end (turns, resume, tool rows, the Ask prompt, the
Space's tools over MCP), the open MCP server with a person-made connection, agent pages after
the deletions, the files, changes and terminal panels, and the Sims-like office. Claude Code's
adapter ran but that install's sign-in had expired; OpenCode isn't installed on this computer.

Phase 6, deleted (about 31,000 lines): the tab strip and its parts, the address bar and browser
search, the person's tab (`BrowserWorkspace`, its pages and internal pages), bars auto-hide,
peek, reader and find, passwords and card and address autofill, import from other browsers,
default-browser registration, the extensions interface, the history and downloads pages, and the
agent tools that listed or opened a person's tabs and bookmarks.

Phase 6, left:

- **Native extensions** (`src-tauri/features/browser/extensions`, about 15,500 lines, and
  `kiri/src/extensions`). It builds every page's configuration on macOS and has large
  Windows-only parts, so it needs its own careful pass.
- **Pinned tabs, tab groups, bookmarks and incognito** in the workspace store. Removing them
  needs a store migration and about twenty test files rewritten.
- **Leftovers**: about twenty browser shortcuts that now do nothing, 21 native commands with no
  caller, `app-windows/addresses/*`, Memory Recall (it records only a person's pages, so it
  records nothing now), help and feedback and the cloud clipboard (no way in), and vault records
  for passwords, cards and bookmarks that have no interface to view or delete them.
- **Windows**: the Windows-only parts of what was deleted were not compiled.
- **`misty-server`** still lists the four removed agent tools in its fixtures.

Still not built: handoffs and claims, multi-run, preview with element picking, the rest of the
Space home dashboard, member limits, images for engines, and the engines' own chat history.

## Where it stands

Written 2026-11-11, after the first pass through every phase on `redesign/workspace`. The type
check, lint and tests pass in the app (`npm run check` parts, `cargo test`, `cargo clippy`) and in
`misty-server` (`go build`, `go vet`, the new tests). None of it has been watched working in the
running app yet, and nothing is committed.

| Phase | Built | Left |
|---|---|---|
| 1 Shell | Sidebar of Space pages and chats; no tabs, no address field; web pages only for agents | Tabs still exist underneath; README |
| 1b Together | Live status of teammates' agents (sidebar, Space home, office) and a stored activity log, as fixed codes only; server relay and log in `misty-server` | Handoffs and claims (they wait on who writes their text); member limits; `AGENTS.md` and the server contract test don't yet state the rule for the log |
| 2 Engines | Adapters for Claude Code, Codex and OpenCode in `src-tauri/features/engines`; engine choice per agent; linked folders; sessions resumed; modes mapped natively and Ask goes to the person; session goals | A real turn was not sent (Codex's handshake was checked, OpenCode isn't installed here); images; multi-run; engine history isn't read from the CLIs' own files |
| 3 Panels | Files with an editor, changes with step-by-step diffs and commit, terminal, in a panel beside the chat (`agents/context-panel`, `src-tauri/features/project`) | Preview with element picking; branches and history in the changes panel |
| 4 Space for engines | Local MCP server (`engines/mcp.rs`) offering the Space's tools and `ask_misty`, through the same journal and gate as Misty's own agent; handed to all three engines | Unverified end to end; a "save to Space" tool for a file in the folder |
| 5 Space home | Agents and what each is doing at the top of home; activity log on a shared Space | Waiting-for-you items, recent chats, linked folders, cost and schedules on home |
| 6 Human browsing | Nothing deleted | Every deletion, each to be confirmed |
| 7 Virtual view | Office in 2D and 3D on the Agents page, with teammates' agents | Not a Space page of its own |

## What already exists

Most of the product is built; the plan mainly re-points the shell at it.

- **Named agents**: `src/shared/schemas/native-agents.ts` (name, role, instructions, avatar, model,
  default mode, `space_id`), saved per device, edited in `AgentEditor.tsx`. Missing: an engine
  field and a per-agent tool list.
- **Spaces**: sections home, chat, notes, drawings, library, memory, members and settings under
  `/spaces/:id/<section>` (`src/features/spaces/overview/SpaceSectionView.tsx`). Presence and live
  editing work today.
- **Agents in Spaces**: chats carry a `spaceId`, agents can be listed as Space members, and
  `agents/artifacts/agentArtifacts.ts` already saves what an agent makes into the Space library.
- **Space tools** for Misty's runtime: `src/features/agents/tools/spaceTools.ts` (`note.*`,
  `file.*`, `thread.*`, `message.*`, `drawing.*`, `space.*`, `search.all`).
- **Watch and take over**: `agent-browser/AgentBrowser.tsx`, `AgentBrowserPip.tsx`,
  `runs/person_takeover.rs`, and the control island.
- **Run events**: one JSON event contract (`runs/invocations/invocationEventTypes.ts`), stored and
  sent to windows by `run_control/local_runs.rs`. This is where another engine plugs in.
- **Generic shell**: `SidebarDrawer`, the dock tree and panes, the tab strip's list and groups,
  `LayoutPopup`, settings overlays.
- **Self-hosting**: `src/api/deployment/serverChoice.ts` already takes any server address.

Not there at all: MCP, ACP, any outside engine, a terminal, a Git panel, a code editor.

## Phase 1: the shell becomes a Space navigator

Built on `redesign/workspace`: `WorkspaceSidebar.tsx` replaces the tab strip. It holds New chat and
the Space's pages, then every chat in the Space under its agent (`SpaceNavigator.tsx`), with no tab
list, address field, favorites or now-playing card. Launch opens the Space home (Agents when signed
out), new views open Agents, the tools row keeps only the window's tools, and the welcome page
says what Misty is. `WorkspaceTabStrip.tsx` and its parts are unmounted, not deleted.

Left:

- Look at it in the running app. It passed the type check and the tests but was not seen on
  screen.
- A person's saved web pages are closed as a window opens, and a route never opens one. Three
  ways to a web page in a pane are left: the search dialog (and the shortcut that opens it), a
  link clicked in a chat or in Memory, and a link another app hands to Misty while it is the
  default browser.
- Agents open ordinary web pages too (`browser.tab.open`, `agents/cursor/normalTabs.ts`), not only
  their own hidden ones, and those show in the pane with the full browser toolbar. Decide where
  such a page is shown before closing the three ways above for good.
- Tabs still exist underneath: each page opened from the sidebar is a hidden tab.
- The downloads button left the sidebar foot with the tab strip.
- The "New tabs and splits" setting still offers Browser, and the new-tab shortcut still opens the
  browser search dialog.
- The README still describes a browser.

## Phase 1b: agents working together in a shared Space

Friends work on a project in one Space, each with their own agents, and every agent knows what
the others are doing. Built now on Misty's own runtime, which already has Space tools; outside
engines get the same tools from the phase 4 MCP server with no change to the Space side.

Decided:

- **Status is automatic.** Native code builds "doing now" from the run's events
  (`run_control/local_runs.rs`): the agent's name, its state (working, waiting for its person,
  done), the kind of tool in use, and the folder and files it touches. The model writes none of
  it, and it never carries the person's prompt, a tool's result or the model's answer.
- **Members see status and saved work.** Which agents each person has in the Space, what each is
  doing, and whatever was saved into the Space (files, notes, artifacts). Chats stay on their
  owner's computer.
- **Live, and an activity log.** Status travels over the Space's presence channel
  (`spaces/list/realtimeTypes.ts`) as it changes, and the Space keeps a readable log of the same
  entries to catch up from. The user named BrowserOS's live activity log as the model; look at it
  before designing the view.
- **Handoffs go through people.** An agent posts a request to another member. It shows under
  "waiting for you" (`interventions/WaitingForYouCard.tsx`), and accepting it makes it that
  person's own request to their own agent. An agent still takes requests only from its owner.
- **Claims warn, they don't block.** "I'm on the login page" is shown to other agents before they
  touch the same thing. A stale claim stops nobody.
- **Another member's posts are data, never instructions.** Enforced in
  `run_control/tool_policy.rs` and `untrusted.rs`, not in the prompt.
- **Free gets one shared Space with a few members** on Misty's hosted server; Pro lifts the
  limits. The server enforces generic per-account limits and `misty-cloud` sets the numbers.

To build:

- **Native**: a status reducer over run events, and three tools for Misty's runtime: read the
  Space's activity, post a claim, post a handoff. All three pass the tool gate.
- **Server** (`misty-server`): status on the presence channel, the activity log, claims and
  handoffs as Space posts, and member limits. This is new server work in the other repository.
- **Interface**: other members' agents and their status in the sidebar and on Space home, the
  activity log as a Space page, handoffs in "waiting for you".

Open:

- The activity log is stored on the server, where it is readable, and `AGENTS.md` says no prompt,
  tool result or model output goes there (`misty-server` has a contract test for it). A status
  built only from native facts fits the rule, but a chat's title is written by the model and
  file names can say a lot. Decide exactly which fields the log may hold, then state it in
  `AGENTS.md` and extend the contract test.
- Whether a claim names a file, a folder, or free text, and when it expires.
- How a handoff's text is written: by the sending agent (model output on the server, which the
  rule forbids today) or by its person.

## Phase 2: outside engines (the ccgui port)

- **New native feature** `src-tauri/features/engines/`, one module per engine, copied from ccgui's
  `src-tauri/src/engine/`. Start with Claude Code and Codex, then OpenCode; the rest follow as
  they are ported. (This order is an assumption, not something decided.)
- **One event contract.** Each adapter translates its engine's stream into Misty's existing events
  (`response.delta`, `tool.started`, `approval.required`, `plan.update`, `invocation.completed`
  and so on) and publishes through `run_control/local_runs.rs`. The existing chat
  (`AgentConversationView.tsx`, `MistyComposer.tsx`, approvals, sub-agent rows, the control island)
  then works for every engine. Add event types only where ccgui shows something Misty can't.
- **Agent definition** gains `engine` (Misty or an outside engine) and its model and effort
  options. `AgentEditor.tsx` gets the engine picker.
- **Linked folders**: a device table in `misty.db` mapping a Space to folders on this computer. A
  chat with an outside engine runs in one of them.
- **Sessions**: ccgui reads each CLI's own session files for history and resume. Keep that, and
  store only an index (engine, session id, Space, folder, title) in `misty.db`. It never syncs.
- **Permissions**: the mode the run started with (ask, auto, plan) is mapped to the engine's own
  flags in native code when the process starts, next to `tool_policy.rs`. The renderer never
  chooses flags.
- **Keys**: engines use their own sign-in and config files. Misty doesn't read or store their keys
  in this phase; ccgui's provider presets can come later.
- **Credit**: add desktop-cc-gui's copyright and MIT text to `NOTICE`, and keep a header on copied
  files. The same for anything copied from OpenChamber.
- **Chat view after OpenChamber**: when the engines land, the chat and its side tools are
  reworked to OpenChamber's layout. Two of its features belong here: **session goals** (the agent
  keeps working until a stated goal is met) and **multi-run** (one task on several models, each
  in its own worktree, then the best parts merged).

Done when: a person picks Claude Code or Codex for an agent, chats in a linked folder inside a
Space, sees streaming, tool calls and approvals in Misty's chat, and can resume after a restart.

## Phase 3: coding panels

Each is a pane view in the existing dock tree, so it can sit beside a chat.

- **File tree and editor** for the linked folder (ccgui: virtualized tree, CodeMirror).
- **Terminal** (ccgui: `terminal.rs` on `portable-pty`, xterm in the renderer).
- **Git panel** (ccgui: `git.rs` on `git2`): stage, commit, branches, diffs, history.
- **Changes walkthrough** (OpenChamber): a large diff shown as ordered steps.
- **Preview with element picking** (OpenChamber): the running app beside the chat; pick an
  element and its screenshot, styles and errors go to the agent. It uses the agent's own page
  beside the chat (`agent-browser/`), never a web page in a pane for the person.
- New surface ids in `workspaceViews.ts` and policies in `panes/dockRegistry.ts`.
- All of it in black, white and gray: ccgui's Git status colors and engine brand colors become
  gray marks. New dependencies are MIT or Apache-2.0.

## Phase 4: engines use the Space

- **A local MCP server** inside the app, reachable only from this computer, handed to each engine
  when its process starts. Tools: the existing Space tools, limited to the Space the chat is in,
  plus `ask_misty`, which starts a run of Misty's own runtime (browser and Space work) and
  returns its answer.
- **The gate stays native.** Every MCP call goes through `run_control/tool_gate.rs` and
  `tool_policy.rs` with the mode the chat started in, exactly like a call from Misty's runtime.
- **Known work**: Space tools run in the renderer's hidden jobs window today
  (`src/features/agents/tools/host.ts`, `runs/jobs/AgentJobWorker.tsx`), so the MCP server calls
  them through that host.
- **Artifacts**: a "save to Space" tool, so files an engine makes in a folder land in the library
  with the same provenance `agentArtifacts.ts` records.
- Nothing from an engine goes to Misty's server except what a tool writes into the Space, as today.

Done when: Claude Code in a linked folder can read a Space note, save a file to the library, and
ask Misty to do something on a web page.

## Phase 5: Space home

`home/SpaceHome.tsx` is a gallery of items today. It becomes the overview of the Space:

- the person's agents in this Space and what each is doing now,
- anything waiting for the person (`WaitingForYouCard`, app requests, questions),
- recent chats, recent artifacts, linked folders, schedules.

The gallery stays as the library's view. First load uses skeletons shaped like these rows.

OpenChamber's dashboard is the model: status, approvals and cost across the Space's work, with
scheduling. Cost is shown only for engines that report it.

## Phase 6: retire human browsing

Only after phases 1 to 5 are in use.

- Keep: kiri, hidden agent tabs, `AgentBrowser`, take over, sign-in state, and whatever the
  `browser.*` tools need.
- Candidates to delete: omnibox, favorites, history, downloads UI, bars auto-hide, now playing,
  peek, pinned tabs, default-browser registration, extensions, password and card autofill,
  browser-data sync (`sync/browser_data`).
- This is the one phase that removes a lot of code, so each item is confirmed before it goes.
  Check first whether agents drive the person's visible tabs (`browser.workspace.*`,
  `runs/jobs/workspaceAutopilot.ts`); that wasn't settled when this was written.

## Phase 7: virtual view

After the ccgui port. A new view of a Space, next to home and chat, drawn from the same state:
agents, their status from run events, and who is waiting on the person.

- **2D first**: a flat room, one figure per agent, clicking one opens its chat.
- **3D second**: the same room in 3D (Hermes3D uses three.js with React Three Fiber, both MIT).
- Much simpler than [Hermes3D](https://github.com/iamlukethedev/Hermes3D): no office builder, gym
  or standups. Black, white and gray unless color is asked for on this surface.
- It reads state and opens chats; it never becomes a second place where agent logic lives.

## Rules this changes

`AGENTS.md` was updated with the direction. Still to change when the code does:

- The tool-policy rule gains: outside engines get their permission flags from native code, and
  their Space and browser calls pass the same gate.
- The chats rule gains: an outside engine's history stays in that engine's own files; Misty keeps
  an index on the device.

## Later, not in this plan

- Agents taking requests from anyone but their owner, including handoffs that start without the
  person accepting them.
- Other members reading each other's agent chats.
- ccgui's plugin system, provider presets, and serving the interface to other devices.
- Showing other members' agents in the virtual view.
