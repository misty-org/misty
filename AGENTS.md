# Misty

Misty is a desktop browser with agents built in (Tauri app in `src/` and `src-tauri/`, server
in `server/`, native web platform layer in `kiri/`). **Start in `docs/`:** [docs/README.md](docs/README.md)
says what Misty is and has one folder per feature. Before changing a feature, read that
feature's `README.md`; it holds what the feature is, where its code lives and its interface rules.

| Working on | Read |
| --- | --- |
| Agents, chat, harness, cursor companion, evals | `docs/agents/` |
| Spaces, Space bar, Space color | `docs/spaces/` |
| Sync, devices, clipboard | `docs/sync/` |
| Voice, notes, memory, memory tree | `docs/voice-memory/` |
| Tabs, media controls, platform limits | `docs/browser/` |
| Extensions, WebAuthn, native web APIs | `docs/kiri/` |
| Settings pages and storage | `docs/settings/` |
| Any visible surface | `docs/ui/` |
| Running a server, Cloudflare Workers | `docs/self-hosting.md`, `docs/cloudflare.md` |
| Model keys and providers | `docs/byok.md` |
| Where Misty is going | `docs/roadmap.md` |

Unbuilt work is in `docs/plans/`. When you finish a feature, update its folder in the same
change; when a plan ships, fold it into the feature folder and delete the plan.

# Rules that apply everywhere

- Interface is black, white and gray. No green, sage, colored status dots, tinted selections or
  accent focus rings unless the user asks for color on that surface. Each existing color
  exception is listed in `docs/ui/README.md` or the feature's README; do not add or spread one.
- Dropdowns and context menus mark the selection with a checkmark, never a dot.
- Never show "Loading…" text; first loads use skeletons shaped like the content.
- Settings belong to the device (`misty.db`) and never sync.
- Tabs live only in the tab sidebar.
- Misty is open source under the AGPL-3.0-or-later (copyleft), with the attribution term in
  `NOTICE`. Add dependencies only under AGPL-compatible licenses (MIT, BSD, Apache-2.0,
  MPL-2.0, LGPL), never proprietary or non-commercial ones. Every feature is on for everyone,
  and nothing is optional: Cloudflare, Composio and Google sign-in are parts of every server. The open server sends no email: it hands out links (sign-in, invitation) and shows
  alerts in the console and the owner's app; Misty Cloud's emails live in misty-billing.
- The open repo has no billing. Misty Cloud is just another Misty server; its Stripe side
  lives in the private misty-billing service and reaches the server only through the
  operator account API (`docs/cloud/`). Never add prices, plan gates or payment code here;
  per-account limits are generic and unlimited unless set.
- Agents and every model call run on the person's computer, on the device's own models
  (`docs/agents/runtime.md`, `docs/byok.md`). Web search runs there too, on the person's own
  search key (Decodo or Serper); the server holds no search key and makes no search call. Keys
  stay on the device and reach only their provider; never send a key, model call or search to
  the server, store or log them.
- No `*.env` file is ever committed, not even an example. Setup is taught in the website's
  docs. Every server address in the app comes from the person's choice, never a built-in
  default (`src/api/deployment/`).

# Commits

- Commit messages and pull request descriptions never carry a `Co-Authored-By:` trailer or any other AI attribution line ("Generated with ...", tool or model names). Commits are authored by the person alone.
