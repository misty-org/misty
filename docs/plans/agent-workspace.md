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

Decided 2026-11-11 (late), with the person:

- **Pick up where any agent left off.** Built (`agents/pickup`, Space home's Pick up card): "Save
  where it left off" asks the chat's agent, in its chat, for a note under fixed headings; the
  person edits it and sends it to the Space as a note titled "Pick up: …" with where it came from
  (agent, engine, folder name). Picking one up starts a chat with any of the person's agents with
  the note in its composer, unsent.
- **The vault is removed**, in the app and in `misty-server`. The agent browser's sign-ins and
  site data stay on each computer.
- **Space content is not end-to-end encrypted.** The server can read notes, chats and files.
- **One server at a time**: self-hosted or Misty Cloud. Built: leaving a server in use restarts
  the app (`useServerSwitch.ts`); the address is `mistyCloudServer()`.
- **Claims are automatic.** Built: an agent's status carries the files its run is writing,
  relative to the linked folder (`agents/virtual/runWork.ts`), and they end with the run or after
  30 quiet minutes. Space home's agent cards name them and warn in amber when a teammate's agent
  is on the same file, and an engine turn starts with a note of teammates' claimed files
  (`engines/run_prompt.rs`). Nothing is blocked. `misty-server` passes relative paths only.
- **A per-Space timeline** of what every agent did, on any engine and in which mode. Built
  natively: `agent_run_ledger` (`run_control/run_ledger.rs`, command `agent_run_timeline`); the
  view is the Live activity log session's.
- **Not planned now**: moving a Space between servers, several servers in one app.
- **Not seen working yet**: claims between two accounts, a pick-up drafted by a real engine.

Work this creates:

- **A plain local mode for `misty-server`**, lower priority: files on disk, no tunnel, and
  `docker compose up` working first time.
- **Free limits** on what costs money: storage, shared Spaces, members and history kept, with
  per-file and per-account caps. Inactive free accounts are never deleted, so the caps matter.
- **A mismatch in `misty-cloud`**: it closes and deletes a cancelled account after 30 days, while
  `AGENTS.md` says the account moves to Free.

## Decisions of 2026-11-11 (night)

- **Interface quality comes first.** The interface today is unpolished. Model it on OpenChamber
  (and OpenHands): floating bars and panels, generous spacing, rounded cards. A little color is
  welcome where it carries meaning (Git changes, file and folder icons); the virtual studio may
  use full color. `AGENTS.md` still states the old gray-only rule and must be brought in line.
- **The studio is a Sims-like world**, built ourselves after Hermes3D in Misty's look: characters
  that walk around, furnished rooms, a card for the picked agent with actions, and a build mode.
  The first 2D/3D studio is far below this and is to be replaced.
- **Phase 6 is confirmed**: delete everything listed there, checking first what agents share.
- **Handoffs**: the agent drafts on the person's computer and the person sends it, so nothing a
  model wrote reaches the server unapproved.
- ~~**The Space MCP server opens** to agents Misty doesn't start.~~ Built, then removed on
  2026-11-11: the person found connecting outside agents unnecessary. The server serves Misty's own
  engine runs only.
- **Order**: prove what exists (look at the app, real Codex and Claude Code turns), then the
  missing features. At most three large commits, not pushed.

## After the night of 2026-11-11

Proven in the running app: Codex end to end (turns, resume, tool rows, the Ask prompt, the
Space's tools over MCP), the open MCP server with a person-made connection (since removed), agent pages after
the deletions, the files, changes and terminal panels, and the Sims-like studio. Claude Code's
adapter ran but that install's sign-in had expired; OpenCode isn't installed on this computer.

Phase 6, deleted (about 31,000 lines): the tab strip and its parts, the address bar and browser
search, the person's tab (`BrowserWorkspace`, its pages and internal pages), bars auto-hide,
peek, reader and find, passwords and card and address autofill, import from other browsers,
default-browser registration, the extensions interface, the history and downloads pages, and the
agent tools that listed or opened a person's tabs and bookmarks.

Since then (uncommitted, checked together: type check, lint, 2,088 interface tests, 533 native
tests, and an agent page and a Codex turn retried in the running app):

- **Phase 6, finished on macOS**: the native extensions module and kiri's extension code, tab
  groups, pinned tabs, bookmarks and incognito in the workspace store (saved windows migrate),
  the person's web view in the store, the browser shortcuts, and 16 native commands with no
  caller. Help is in the account menu.
- **Space home** is a dashboard: agents now, waiting for you, recent chats, project folders.
- **Handoffs and claims**, carried over the Space's own chat as the person's messages, marked by
  their first words ("Handoff:", "Working on:"). No server change.
- **Multi-run**: one task on several engine agents, each in its own Git worktree, compared side
  by side, with "Keep this one" merging into the linked folder staged and uncommitted.
- **Preview with element picking**: a Preview tab for a local dev server; the picked element's
  details go to the composer.

Left:

- **Windows**: none of what was deleted or edited in Windows-only code has been compiled. The
  files are listed in the session's reports; build on Windows before releasing.
- **Not seen working**: handoffs between two accounts, multi-run in the app (it needs a linked
  folder that is a Git repository), a real pointer pick in Preview, teammates' agent status
  between two accounts, Claude Code (its sign-in had expired) and OpenCode (not installed).
- **Also built**: attached pictures go to all three engines, and `misty-server` has two more
  per-account limits (shared Spaces, people per Space), unlimited unless `misty-cloud` sets them.
  The server's whole suite passes against its test database.
- **Left out on purpose**: reading each engine's own chat history, since Misty keeps every chat's
  transcript itself.
- **Phase 6 dead-code pass (2026-11-11, uncommitted), done**: everything left of a person's own
  browsing is gone, front end and native: site styles, zoom by site, mouse gestures, Peek, the
  tab-history budget, the bars slide, pane dimming and card previews of pages, the address-bar
  search seed, Memory Recall's page recorder, subtitles' "Generate from page", reader articles,
  "Transcribe this tab" (and Kiri's media tap), Ask about a page, tab and group renaming, the cloud
  clipboard, the vault's password, card, address and bookmark kinds (stored rows are kept, never
  read), the "browser" and "extensions" surfaces and the `/browser` route (Agents is the landing
  route), the page menu's dead items (Back, Forward, Reload and the trackpad swipe now run natively),
  Misty's own site-permission asks (the engine asks now), the old Agents-page sidebar, CSS no
  element uses, and 25 native commands with no caller, with their permissions and tests. The Misty
  guide in the cursor companion's prompt describes the workspace instead of the browser.
- **Also removed**: live subtitles, which had no way in once the Browser menu went (the panel,
  its commands and capability, and the Misty-tabs audio capture).
- **Workflows, schedules and skills are gone** (2026-11-11): engines have them natively. Removed
  the Workflows page and pin, the Scheduled surface, Integrations › Skills, the saved-methods store,
  browser replays, the `memory.workflow.*` tools, Memory's Workflows branch, and the run fields
  that carried a method, a schedule or skills.
- **Still open**: an account's sign-in password can't be changed from the app
  (`accountChangePassword` has no screen). The device policy keeps its always-false `clipboard`
  field: it is part of the signed record other devices verify.

## Decisions of 2026-11-11 (day): engines are the brain, and Tutor

Order of work: browser tools on the MCP server, then finishing the interface, then Tutor.

### Engines are Misty's brain

Misty needs no model of its own. The person's engines (Claude Code, Codex, OpenCode and the like) do
the thinking, and Misty's harness is what they use through the local MCP server
(`src-tauri/features/engines/mcp.rs`): the browser, take-over, Space tools and the gate.

- **Browser tools on the MCP server.** Today the server offers only the Space families and sends
  browser work through `ask_misty`, which starts Misty's own agent on its own model key. The browser
  tools are offered directly instead, so an engine drives Misty's browser itself while the person
  watches and takes over to sign in. Each call passes the native gate. In a Manual chat, opening and
  reading pages runs freely, and clicking, typing and submitting ask first; Auto doesn't stop for
  ordinary work. `ask_misty` stays, offered only when the person has set up Misty's own agent.
- **The browser is opt-in per message** (decided with the person, 2026-11-11 evening). An engine run
  gets the browser tools only when the person attaches Misty's browser to the message (the
  composer's Attach menu, or `/browser`); otherwise it uses its own tools. The person also has a
  plain browser of their own in the chat's right rail, which agents don't drive.
- **Modes move to engines.** Plan maps to each engine's own plan mode through native
  permission flags. Workflows and schedules are the engines' own. Anything Misty does with a
  model in the background goes through an engine or goes away.
- **Misty's own runtime stays in the code**, hidden and not the default.
- **First run** finds which CLIs are installed and signed in, and starts with one of them. The
  composer doesn't say "Message Misty…" unless the chat is with Misty's own agent.
- **Terms.** Misty always starts the vendor's own CLI under the person's own sign-in. It never
  reuses or proxies their subscription tokens.

### Teach becomes Tutor

Tutor is the cursor companion that floats over the desktop and shows the person what to do. It is
first-class but optional, and a harness like the browser. It was `src/features/agents/cursor` (now under `tutor/`),
the voice session in `src-tauri/features/agents/runs/voice`, lessons and the Teach chat mode.

- **Its live conversation never goes through a CLI**, which is too slow for live voice. Its brain is
  a raw fast model on the person's own key.
- **Setup is layered**, and only the model key is required: with no keys Tutor is off; a fast model
  that reads images gives typed questions, answers in bubbles and pointing; Soniox adds talking and
  live translation; ElevenLabs lets it talk back.
- **Engines don't drive the overlay.** Offering it as MCP tools (`tutor_point` and the like) was
  proposed and turned down: an engine's turn takes seconds, so pointing would lag what is on screen.
  Tutor's voice tools `start_task` and `steer_task` hand bigger work to the person's chosen engine.
- **Interface.** A permanent place in the top bar and a hotkey. Not set up, a click opens a short
  setup with one field and a test button per key. Its own Settings section, keys on the device,
  never synced. macOS Screen Recording and Accessibility are asked for on first use. States: off,
  needs setup, ready, listening. Labels say Tutor.
- **Code.** Tutor becomes its own feature (`src/features/tutor`, `src-tauri/features/tutor`). Teach
  leaves the chat's Act/Plan/Teach toggle. The Fast role is called "Tutor model" in Settings.

### Built on 2026-11-11 (day), uncommitted

- **Claude Code, seen working**: turns, resume, tool rows, the Ask prompt and the Space's tools.
- **Browser tools for engines**: `mcp.rs` offers a run `screen_open`, `screen_close`, the reading
  tools and the acting tools; `browser_act` and `browser_extract` are left out because they read a
  page with Misty's own model. A connected outside agent gets none of them. A chat's agent keeps
  its tabs from one turn to the next (`adoptChatTab`). Seen working with Claude Code only.
- **Interface**: the app runs edge to edge; every page has one 48px top band; corners follow
  4, 7, 9 and 12px; sidebar rows are 32px. The chat has a right-hand rail of panels with a Session
  panel, and the open panel floats beside the chat. Journal is its own page of notes and drawings.
- **Studio**: Misty's own scene, with no Hermes3D integration (decided). The room has a size
  (28 by 18 to start, 20 by 13 up to 48 by 32) that build mode changes; walls sink and rise
  smoothly; figures sit down from free floor beside a seat and get up before leaving; walk mode
  puts the person in the room as a figure.
- **First run**: an agent is made for each engine found installed, once per engine, and new chats
  start with one of them. Get started opens a setup page (`onboarding/setup-page`, also Help ›
  Run setup again): each engine shows one next step (Install, Sign in, Ready), and then the
  Composio key and one-click sign-ins for common apps. An npm engine says it needs Node.js first.
  Seen only in a mocked preview: the native app didn't build while `features/memory` was mid-change.
- **Apps connected directly** (2026-11-11, decided with the person: no keys of Misty's, no
  middlemen): the person signs in to an app maker's own MCP server (MCP authorization with dynamic
  client registration and PKCE, a one-time callback on 127.0.0.1), the tokens stay in the keychain,
  and every engine reaches the app through `integration_*` on Misty's MCP server, through the same
  gate and approval cards as Composio (`connected_apps/direct`). The shipped catalog
  (`direct/catalog.json`, made by `generate.rs` from the official MCP Registry on 2026-11-11) holds
  6,491 apps whose sign-in was checked keyless, 6,301 with the maker's own logo (published with the
  server or declared by its home page; native code fetches and keeps it). Only servers on the
  domain their publisher proved are kept, skipping publishers with more than five servers (they
  list other companies' apps) and other brands' names. Search adds the registry's newer makers,
  checked live. Regenerate it before each release.
  Composio stays for apps without a direct sign-in (Gmail, Google Calendar, Slack, GitHub, Outlook,
  HubSpot, Asana). A sample of 400 registry servers: 37% keyless, 54% need no sign-in.
  Left: a real sign-in and tool call in the running app; servers that only take Client ID
  Metadata Documents (needs a public JSON on Misty's website, not a key); the agent's Connect card
  for a direct app (agents can only ask for Composio apps today); servers that need no sign-in.

Checked against the code, already so:

- **Plan** maps to each engine's own plan mode: Claude Code's `plan` permission mode, Codex's
  read-only sandbox with no approvals, OpenCode's `plan` agent.

Left from these decisions: Tutor as its own feature; rigged characters for the studio (a model download the person has to allow); light
theme.

## Decisions of 2026-11-11 (evening): Tutor is a place to learn

Tutor grows from the cursor companion into a section of its own, after open-notebook; the cursor
companion is one tab of it. Pages have no title bar: the sidebar and the tab name them.

Built, uncommitted (`src/features/agents/tutor`, with `lessons/` and `cursor/` moved under it): tabs
Learn, Notebooks, Flashcards, Guides and Cursor.

- **Notebooks** hold sources: files read by the confined document worker (`tutor_pick_sources`),
  recordings transcribed with speakers on the person's Soniox key (`tutor_transcribe_sources`),
  links and pasted text. Each is sent in full, as a summary or not at all. Notes, built-in and
  custom transformations, search in a notebook, and questions answered with numbered citations.
- **Made by the person's own agent** in background runs kept out of the sidebar (`tutorRuns.ts`):
  guides, flashcards, quizzes, lessons, and audio overviews, whose two-voice script is spoken on
  the device's speech key and kept as a WAV in Misty's folder (`tutor_overview_*`).
- **Flashcards** review on SM-2.
- **Search across notebooks** by meaning on the device's embedding model, vectors cached in
  `misty.db` (`tutor_index`); by words without one.
- **Sharing**: a notebook, guide, quiz or overview goes to the window's Space as a note, only when
  the person asks; sharing again updates that note.

Everything else in Tutor lives in `misty.db` and never syncs.

Redesigned the same evening after NotebookLM, at the person's request: Tutor's home asks what to
learn (a notebook whose agent finds sources on the web) and shows notebooks as cards; a notebook is
three floating panels: sources and notes with checkboxes, the conversation with an agent-written
overview and clickable citations, and a studio of tiles (audio overview, mind map, reports, flashcards,
quiz, slides, data table, teach me) whose outputs open in place. Misty reads links, PDFs and YouTube
captions itself (`tutor_read_link`) and dropped files through the document worker
(`tutor_read_dropped`). Tutor's runs are ordinary chat turns, never the agent desktop. Seen working
end to end with Codex: sources found and read, overview, a cited answer, a mind map.

Video overviews: the engine writes each scene's narration, drawing and shot; the narration is spoken
on the speech key and each shot filmed on the Video model in Settings → Models (Google's Gemini Omni
on the person's own key, the one video API left since Sora and the Veo previews shut down), else
the drawing shows. Filming has never been run against Google.

Left: a notebook shared with a Space as a live notebook rather than a note.

## Decisions of 2026-11-12: the Lab, the person's own place

Misty serves people, businesses and developers, and lets someone move between them: a question
becomes a notebook, a notebook is shared into a Space, a Space's agents show in the Studio. One
sign-in to an engine carries across all of it.

- **Names.** Tutor's section is the **Lab** (a flask in the sidebar), the place to learn, research
  and do personal work with agents; what it holds are notebooks. A Space shows a galaxy. "Tutor"
  stays the name of the cursor companion inside it. A Space's Journal is **Docs** and its notes
  are docs, because they are shared and edited together. Done first as what people see and the
  route and pin IDs; the code folders, `tutor_*` commands, stored keys and the
  server's `/notes` follow later, in both repositories at once.
- **Topics.** The Lab's home offers common research topics (Finance, Marketing, Business,
  Technology and AI, Science, Health, Law and policy, Study). A topic is a setup, not a feature:
  questions to start from, what the agent looks for first, and what the notebook offers to make.
  Starting from one makes an ordinary notebook. Verticals never get sections of their own.
- **Following.** Any notebook can follow the news on its subject (its ⋯ menu). Each time it opens,
  or on "Look for news now", recent stories come in through the person's search key (Serper or
  Decodo, kind `news`, `notebook_news`) and land as dated sources the agent cites. No background
  schedule.
- **Finance is only a topic.** Prices, charts and a market data key were built and taken out the
  same day: there is no dependable keyless source of stock prices (Google and Yahoo license theirs
  and offer no public API; Twelve Data and Alpha Vantage need a key each person gets), and a key is
  too much to ask of people here to learn. Not to be picked up again unless the person asks.
- **Never.** Trading, buy or sell advice, live tickers or watchlists.
- **Tutor is a switch, not a place.** It works anywhere on the desktop while Misty runs, so it
  isn't in the Lab or any page. It's turned on and off from the menu bar (Tutor, checked while
  on; "Set up Tutor…" until it has a model with a key; Tutor settings), which the main window keeps
  in step (`cursor_companion_tray`, `tutorTray.ts`). Its setup is Settings › Tutor: Misty's sprite,
  what Tutor is doing and its switch, then the Tutor model and its key (the one required step),
  the optional voice keys (Soniox to hear, ElevenLabs to talk back) and how it behaves.

## Decisions of 2026-11-12 (afternoon): someone who knows nothing about AI

The test for the beta: a friend who has never used AI or code makes Misty their daily driver, and
people learn from each other in it. Decided with the person:

- **Never ask anyone to buy anything.** Setup is "Pick an AI to start with" and leads with the two
  free ones: Antigravity (Google's CLI, free on any Google account; Gemini CLI stopped taking
  personal accounts on 2026-06-18 and waits under More) and OpenCode (its free models, no account).
  Codex and Claude Code follow, each saying which account it uses.
- **No terminal to type into.** Antigravity and OpenCode install through their makers' own
  installers (no Node.js); first-run installs start at once and fold the commands and the
  installer's terminal under Show details. Sign-in says in a sentence what to do in the browser.
  Antigravity has no status command, so a sign-in Misty watched finish counts
  (`cli_signed_in_here`, never synced); on Linux its token file's presence does.
- **No dead end.** With no engine and no model key, an empty chat offers setup instead of a
  failing first message; otherwise it shows starter ideas that fill the composer, unsent.
- **Misty Cloud by default.** Signing in is one Continue with Misty Cloud button; the person's own
  server is a quiet second choice. The UI says Misty Cloud, not Misty Pro, for the server.
- **Tours.** A shared `Tour` (`src/shared/ui/overlays/Tour.tsx`) and `TourHost`
  (`onboarding/tours`): the welcome tour the first time the chat opens after setup, then each
  page's own (Space, Lab, Studio, Integrations) the first time it opens. Show me around (account
  menu, Help) replays the page's tour. Seen tours are kept per device. Space home has a Get started
  list that ticks itself off from what really happened. The Lab is pinned in the sidebar by default.
- **No chat sharing.** Chats stay on the device.
- **Notebooks shared live.** A Lab notebook's menu shares it with the window's Space, after a
  confirm that says who will see it: it becomes a doc titled "Notebook: …" (overview, sources with
  their summaries, notes; never a source's full text) that is rewritten as the notebook changes,
  until Stop sharing. Others see it under "Shared in <Space>" on the Lab's home and can save it into
  their own Lab, where its links become sources their own AI reads again.

Not yet seen in the running app: any of the above (the native app didn't build while another
session was mid-change in the same checkout), a real Antigravity or OpenCode install and sign-in,
and a notebook shared between two accounts.

## Memory

Removed 2026-11-11, too much to maintain for the beta: engines keep their own memory. Gone are the
Memory page and settings, recall (remembered dictation and captures, recaps, the morning brief, the
Journal's Day view), the `mem_*` tools for Misty's agent and for engines over MCP, the memory
context in each run, agents' remembered preferences, and `src-tauri/features/memory`. Migration 35
drops its tables. Don't add it back.

## ccgui parity

Decided 2026-11-11: Misty matches desktop-cc-gui feature for feature or goes beyond it. The whole
list, with what is done and what is left, is `docs/plans/ccgui-parity.md`. Decided with it:

- **Bypass** is a fourth mode beside Ask, Auto and Plan: native code passes the engine's own
  skip-permissions flag. Space and browser calls still pass Misty's gate.
- **Provider channels** come across, with presets and CC Switch import. Keys stay in the OS
  keychain on the device, never sync, and reach only the vendor chosen.
- **No plugin system.** The engines have their own (Claude Code plugins, Codex plugins and
  skills), and Misty lists their commands and skills.
- **No remote interface.** The desktop app is not served to phones or other computers.
- **Usage limits** are read through each CLI, never from the person's sign-in in the Keychain.

## Where it stands

Written 2026-11-11, after the first pass through every phase on `redesign/workspace`. The type
check, lint and tests pass in the app (`npm run check` parts, `cargo test`, `cargo clippy`) and in
`misty-server` (`go build`, `go vet`, the new tests). None of it has been watched working in the
running app yet, and nothing is committed.

| Phase | Built | Left |
|---|---|---|
| 1 Shell | Sidebar of Space pages and chats; no tabs, no address field; web pages only for agents | Tabs still exist underneath; README |
| 1b Together | Live status of teammates' agents (sidebar, Space home, studio) and a stored activity log, as fixed codes only; server relay and log in `misty-server` | Handoffs and claims (they wait on who writes their text); member limits; `AGENTS.md` and the server contract test don't yet state the rule for the log |
| 2 Engines | Adapters for Claude Code, Codex and OpenCode in `src-tauri/features/engines`; engine choice per agent; linked folders; sessions resumed; modes mapped natively and Ask goes to the person; session goals | A real turn was not sent (Codex's handshake was checked, OpenCode isn't installed here); images; multi-run; engine history isn't read from the CLIs' own files |
| 3 Panels | Files with an editor, changes with step-by-step diffs and commit, terminal, in a panel beside the chat (`agents/context-panel`, `src-tauri/features/project`) | Preview with element picking; branches and history in the changes panel |
| 4 Space for engines | Local MCP server (`engines/mcp.rs`) offering the Space's tools and `ask_misty`, through the same journal and gate as Misty's own agent; handed to all three engines | Unverified end to end; a "save to Space" tool for a file in the folder |
| 5 Space home | Agents and what each is doing at the top of home; Happening now cards; each run's steps, page pictures and playback in its chat (`agents/activity`, `run_control/run_steps.rs`); activity log on a shared Space. The Space Activity page was removed (2026-11-11): chats already show it | Waiting-for-you items, recent chats, linked folders and cost on home; the activity views not yet watched in the running app |
| 7 Virtual view | Studio in 2D and 3D on the Agents page, with teammates' agents | Not a Space page of its own |

## What already exists

Most of the product is built; the plan mainly re-points the shell at it.

- **Named agents**: `src/shared/schemas/native-agents.ts` (name, role, instructions, avatar, model,
  default mode, `space_id`), saved per device, edited in `AgentEditor.tsx`. Missing: an engine
  field and a per-agent tool list.
- **Spaces**: sections home, chat, notes, drawings, library, members and settings under
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
- recent chats, recent artifacts, linked folders.

The gallery stays as the library's view. First load uses skeletons shaped like these rows.

OpenChamber's dashboard is the model: status, approvals and cost across the Space's work. Cost is shown only for engines that report it.

## Phase 6: retire human browsing

Only after phases 1 to 5 are in use.

- Kee home and chat, drawn from the same state:
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
