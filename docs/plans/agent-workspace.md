# Misty as a workspace for agents

Written 2026-11-10. Delete each phase when it is done, and this file when all of them are.

Misty stops being a browser for people and becomes a workspace where a person's agents work
inside Spaces. The interface and the attention change; almost all the code stays.

## Decided

- **Any engine.** The main chat runs outside agent engines (Claude Code, Codex and others), ported
  from [desktop-cc-gui](https://github.com/zhukunpenglinyutong/desktop-cc-gui) (MIT). Its code is
  copied in and credited, not added as a dependency.
- **Misty's own runtime stays** for browser work and Space work. Nobody has to use it.
- **The built-in browser is for agents.** A person can watch a page an agent is using and take it
  over (to sign in, pass a check, or steer). There is no tab list of web pages, address bar,
  favorites or history as the main interface.
- **The sidebar is a Space navigator**: the Space's sections, the person's agents and their chats.
  Tabs and split panes stay as the container for views.
- **Views over one Space**: home, chat, and later virtual (2D and 3D), all showing the same agents.
- **Agents belong to the person.** They are saved on the computer, placed into Spaces, and take
  requests only from their owner. Sharing or calling someone else's agent is not part of this plan.
- **Folders are linked to a Space** on each computer. Engines run in those folders. The link is a
  device setting and never syncs.
- **Engines reach a Space two ways**: direct tools for notes, files and threads, and one "ask
  Misty" tool that hands browser work to Misty's own agent.
- **Coding panels that come across**: file tree and editor, terminal, Git panel. Not ccgui's plugin
  system.
- **Self-hosting stays** next to Misty's hosted server.

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

## Phase 0: land the layout branch

`refactor/layout` has 74 uncommitted files (the Space bar removed, tools row moved to the sidebar
foot, layout mode). Commit or drop that work first, so the shell change starts from a clean tree.

## Phase 1: the shell becomes a Space navigator

Nothing is deleted in this phase; browser pieces are unmounted, not removed.

- `WorkspaceTabStrip.tsx`: replace the address slot, `FavoritesStrip` and `SidebarNowPlaying` with a
  Space switcher, the Space's sections, the person's agents, and recent chats for that Space
  (`AgentRecentConversations.tsx`, `AgentSwitcher.tsx`). Open tabs stay listed.
- `settingsConstants.ts` (`workspaceDefaultViewIndex`) and `src/app/shell/startupRoute.ts`: start
  in the last Space's home instead of `/browser`. Unknown routes go there too
  (`routing/RouteConfig.tsx`).
- `workspaceViews.ts`: the `browser` surface stays, but only an agent's page opens in it. The
  new-tab button opens a new chat, not the browser search dialog.
- `SidebarToolsRow` / `browser/pages/SidebarTools.tsx`: drop history, downloads, passwords, find,
  reader and picture-in-picture from the row.
- Remove dead leftovers found on the way: `NavigationItem.ts`, `NavigatorDestinationIcons.tsx`.
- Onboarding (`src/features/onboarding`) and the README say what Misty now is.

Done when: a fresh launch opens a Space home, the sidebar shows sections, agents and chats, and
no address bar is visible anywhere.

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
  files.

Done when: a person picks Claude Code or Codex for an agent, chats in a linked folder inside a
Space, sees streaming, tool calls and approvals in Misty's chat, and can resume after a restart.

## Phase 3: coding panels

Each is a pane view in the existing dock tree, so it can sit beside a chat.

- **File tree and editor** for the linked folder (ccgui: virtualized tree, CodeMirror).
- **Terminal** (ccgui: `terminal.rs` on `portable-pty`, xterm in the renderer).
- **Git panel** (ccgui: `git.rs` on `git2`): stage, commit, branches, diffs, history.
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

- "Tabs live only in the tab sidebar" stays true; the sidebar gains the Space navigator above them.
- The tool-policy rule gains: outside engines get their permission flags from native code, and
  their Space and browser calls pass the same gate.
- The chats rule gains: an outside engine's history stays in that engine's own files; Misty keeps
  an index on the device.

## Later, not in this plan

- Other people's agents acting in a shared Space, or agents taking requests from anyone but their
  owner.
- ccgui's plugin system, provider presets, and serving the interface to other devices.
- Showing other members' agents in the virtual view.
