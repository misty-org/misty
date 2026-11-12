# Misty

Misty is a workspace for a person's agents, organized into Spaces: a Tauri app in `src/` and `src-tauri/`, with its
native web platform layer in `src-tauri/features/kiri`. It began as a desktop browser with agents built in and is
being moved over; `docs/plans/agent-workspace.md` says what is left. The built-in browser is for agents, and a person
only watches a page or takes it over. The server is the sibling repository
[misty-server](https://github.com/misty-org/misty-server). The code is the source of truth, so read it before
changing a feature. There are no feature docs to keep current, and none should be added unless asked.

# Rules that apply everywhere

- The interface is quiet and mostly neutral, and it has to look finished: flat panes split by hairlines on the
  window's surface, never floating cards, with generous spacing, modelled on OpenChamber. Color is used where it carries meaning: Git changes, file and folder icons, an agent's
  state, an engine's own mark. The studio uses full color. Selections and focus rings stay neutral.
- Dropdowns and context menus mark the selection with a checkmark, never a dot.
- Never show "Loading…" text; first loads use skeletons shaped like the content.
- Labels, buttons and headings use sentence case. No subtext under titles, buttons or forms, except settings rows.
- Settings belong to the device (`misty.db`) and never sync.
- The sidebar holds the Space's pages and the person's chats. It lists no tabs and has no address field.
- An agent belongs to the person who made it, is saved on their computer, and takes requests only from them.
- Code copied from another project keeps its license header and is credited in `NOTICE`.
- Misty is open source under the AGPL-3.0-or-later (copyleft), with the attribution term in `NOTICE`. Add
  dependencies only under AGPL-compatible licenses (MIT, BSD, Apache-2.0, MPL-2.0, LGPL), never proprietary or
  non-commercial ones.
- The open repositories have no billing. Misty Pro's Stripe side lives in the private `misty-cloud` service and
  reaches the server only through the operator account API. Never add prices, plan gates or payment code here. The
  server only enforces generic per-account limits, each unlimited unless set, and `misty-cloud` decides the numbers.
- Nothing AI runs on the server. Agents, every model call, tools and chats run on the
  person's computer, on that computer's own keys. Keys reach only their provider: model keys, an engine's provider
  channel key (kept in the OS keychain, never synced), the search key (Decodo or Serper), the Composio key, and the
  tokens from signing in to an app's own MCP server (keychain, never synced, sent only to that app). Never send a
  key, prompt, tool result or model output to the server, store or log them. `misty-server` has a contract test
  that enforces this.
- Apps connect with no key of Misty's and no middleman: Misty offers a direct sign-in only to a server run by the
  app's own maker that registers Misty during the sign-in (`agents/connected_apps/direct`). Anything else goes
  through the person's own Composio key or the app's web page. Misty never registers an app of its own with a
  vendor or holds a client secret.
  What a shared Space's members see of each other's agents is the one thing that leaves: the agent's name, a fixed
  code for its state and one for the kind of work, and its claim: the paths, relative to the linked folder, of the
  files its run is changing. All of it is built in code from the run and never written by a model. The server drops
  anything else (`realtime_agents.go`).
- Misty has no memory, workflows, schedules or skills of its own: engines already have them natively. Don't add them back.
- Misty needs no model of its own. The person's engines do the thinking and use Misty's harness (the browser, Space
  tools) through the local MCP server. Misty starts the vendor's own CLI under the person's own
  sign-in, or on a provider channel they set up, and never reads, reuses or proxies their subscription tokens. Misty's own runtime stays in the code, not the default.
- Tutor, the cursor companion, runs its live conversation on a raw fast model on the person's own key, never through a
  CLI. Its keys stay on the device.
- What agents may do is decided in native code (`src-tauri/features/agents/run_control/tool_policy.rs`), from the mode
  the run started with, never from the renderer at call time, the model or a page. An outside engine (Claude Code,
  Codex and the like) gets its permission flags the same way, and its calls into a Space or the browser pass the same
  gate. Agents are autonomous: Auto doesn't
  pause for ordinary work, and Bypass passes the engine's own skip-permissions flag, chosen by the person.
- Agent chats live in `misty.db`, stay on the device and never sync. Space notes, chats and files are
  readable on the server.
- No `*.env` file is ever committed, not even an example. Every server address in the app comes from the person's
  choice, never a built-in default; the one address the app knows is Misty Cloud's, used only when someone chooses
  Misty Cloud, Free or Pro (`src/api/deployment/`).

# Design protocol

Every visible thing is built from `src/shared/ui`. A feature puts shared components together and never picks its own
colors, borders, corners, sizes or spacing, or adds a stylesheet of its own. When a feature needs a look the shared set
doesn't have, add it to `src/shared/ui` first, then use it. `src/tests/architecture/uiRules.ts` enforces this.

The protocol governs the pieces, not the pages. A page's layout, hierarchy, sections, cards, icons and color are its
own and change only when the person asks for that page to change. Moving a page onto shared components keeps it
looking as it did.

- Nothing wraps into ragged rows or spills past its edge. Every bar declares what gives way first: labels turn into
  icons, then the longest name shortens, then items move into a ⋯ menu.
- Long text (names, models, paths, branches) shortens with a fade-out edge (`OverflowFadeText`), never an ellipsis.
- A control that doesn't work, or doesn't apply where it is, isn't shown.
- An item's actions live in one place, its action bar or its ⋯ menu, never as a stray icon beside it.
- No loose status words ("Saved", "Done") in a row. Changes save themselves, and a failure shows next to what failed.
- Controls in one row share one height. Spacing comes from the 4px scale, with no one-off pixel widths.
- Buttons have four roles and three sizes: primary (at most one per surface), secondary, quiet, and danger (only where
  something is deleted), at 24, 32 and 36px, with 36 only in dialogs and empty states.
- The composer is one bar that never wraps. Where the chat works (Space, folder, branch) is a path line under the box,
  and screen capture lives in the + menu.
- Every message has the same action bar under it, aligned to its edge, shown on hover and always on the latest message.
- A saved secret is one field the size of the empty one that says it's saved, with Replace and Remove in its ⋯ menu.
- A shortcut is recorded in an ordinary field, one per command, cleared with its ×.
- Settings keep their sections and rows as they are, and list only what exists today.
- Type follows the scale in `src/styles/theme.css`: 14px in controls, 15px body, 16px page text. One font everywhere,
  the system font; monospace only inside code itself (code blocks, the editor, diffs, the terminal), never for URLs,
  paths, IDs, model names or shortcuts.
- Every menu item (dropdowns and right-click) starts with a 16px icon, and the selection is a checkmark.
- Icons, logos and engine marks stand bare, never inside a box: no fill, border or rounded tile behind them. Only an
  avatar (a person's picture or initial) has a shape of its own.
- Labels never get cut off. When tiles or buttons are too narrow for their labels, the grid drops a column first.
- The agent browser opens on a blank page and searches with Google, never DuckDuckGo.
- A row's state sits at its right end: a spinner while an agent works, an amber dot when it waits on the person, a
  dot when unread, otherwise the time.
- A row's actions are one ⋯ at its right end on hover, opening the same menu as right-click.
- Pages have no title bar: the sidebar names the page. A page's top bar holds only its controls.
- An empty state is centered in its pane: a title, one muted line, one button (`EmptyState`). The page's top bar
  doesn't repeat that button while it shows.
- Deleting always asks first in a small dialog: what goes, then Cancel (quiet) and Delete (danger).
- Notices stack at the bottom right, carry at most one action and leave on their own. Errors in a form show next to
  the field.
- Tooltips are Misty's own (`Tooltip`), quick, with the shortcut when shortcut hints are on, never the system title.
- The Studio and Tutor are in full color. The Studio's panels float over the office as translucent panels; it and
  settings are the only places with floating panels.

# Decided, not built

Misty Cloud, the hosted server, is where most people keep and share Spaces; self-hosting stays free and complete, mostly
for developers and people who want their own. Spaces live only on a server, never in the desktop app. The code stays
AGPL. Free returns on the hosted server with every feature and small limits, and $10 Misty Pro is the cheapest
paid plan. When Pro ends or a payment fails, the account moves to Free. Inactive free accounts are never deleted.

# Commits

- One commit per session, made at the end, covering all of that session's work. Never a string of small commits.

- Commit messages and pull request descriptions never carry a `Co-Authored-By:` trailer or any other AI attribution
  line ("Generated with ...", tool or model names). Commits are authored by the person alone.
