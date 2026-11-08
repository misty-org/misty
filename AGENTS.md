# Misty

Misty is a desktop browser with agents built in: a Tauri app in `src/` and `src-tauri/`, with its native web
platform layer in `src-tauri/features/kiri`. The server is the sibling repository
[misty-server](https://github.com/misty-org/misty-server). The code is the source of truth, so read it before
changing a feature. There are no feature docs to keep current, and none should be added unless asked.

# Rules that apply everywhere

- Interface is black, white and gray. No green, sage, colored status dots, tinted selections or accent focus rings
  unless the user asks for color on that surface. Don't spread an existing color exception.
- Dropdowns and context menus mark the selection with a checkmark, never a dot.
- Never show "Loading…" text; first loads use skeletons shaped like the content.
- Labels, buttons and headings use sentence case. No subtext under titles, buttons or forms.
- Settings belong to the device (`misty.db`) and never sync.
- Tabs live only in the tab sidebar.
- Misty is open source under the AGPL-3.0-or-later (copyleft), with the attribution term in `NOTICE`. Add
  dependencies only under AGPL-compatible licenses (MIT, BSD, Apache-2.0, MPL-2.0, LGPL), never proprietary or
  non-commercial ones.
- The open repositories have no billing. Misty Pro's Stripe side lives in the private `misty-cloud` service and
  reaches the server only through the operator account API. Never add prices, plan gates or payment code here. The
  server only enforces generic per-account limits, each unlimited unless set, and `misty-cloud` decides the numbers.
- Nothing AI runs on the server. Agents, every model call, tools, memory, chats, workflows and schedules run on the
  person's computer, on that computer's own keys. Keys reach only their provider: model keys, the search key (Decodo
  or Serper) and the Composio key. Never send a key, prompt, tool result or model output to the server, store or log
  them. `misty-server` has a contract test that enforces this.
- What agents may do is decided in native code (`src-tauri/features/agents/run_control/tool_policy.rs`), from the mode
  the run started with, never from the renderer at call time, the model or a page. Agents are autonomous: Auto doesn't
  pause for ordinary work.
- Agent chats and memory live in `misty.db`. Chats never sync, and memory syncs only through the encrypted vault, so
  the server can't read it. Only the vault is protected from the server: Space notes, chats and files are readable there.
- No `*.env` file is ever committed, not even an example. Every server address in the app comes from the person's
  choice, never a built-in default; the one address the app knows is Misty's own, used only when someone chooses
  Misty Pro (`src/api/deployment/`).

# Decided, not built

Everyone will share one hosted server, so friends can share Spaces. The code stays AGPL, and self-hosting stops being
a product. Free returns on that server with every feature and small limits, and $10 Misty Pro is the cheapest paid
plan. When Pro ends or a payment fails, the account moves to Free. Inactive free accounts are never deleted.

# Commits

- Commit messages and pull request descriptions never carry a `Co-Authored-By:` trailer or any other AI attribution
  line ("Generated with ...", tool or model names). Commits are authored by the person alone.
