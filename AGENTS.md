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

# Commits

- Commit messages and pull request descriptions never carry a `Co-Authored-By:` trailer or any other AI attribution line ("Generated with ...", tool or model names). Commits are authored by the person alone.
