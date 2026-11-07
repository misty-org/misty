# src layout

Status: planned, nothing moved. Written 2026-11-07. Delete this file when the work is done, so
nothing finished stays in `docs/`. The Rust side is in [src-tauri-layout.md](src-tauri-layout.md);
both use the same feature names.

`src/` is 1,679 files and about 160k lines. The layering is sound: `shared/`, `api/` and
`native/` almost never import `features/` or `app/` (3 files in all), and features are imported
through `index.ts`. The trouble is inside `features/`.

## What is wrong

1. Agent conversations are split over five features: `agents` (443 files, 51k lines), `misty` (75),
   `ai-surface` (35), `agent-interventions` and `chat-composer`. They import each other
   heavily: 82 files in `agents` import `misty` and 28 in `misty` import `agents`; `agents` and
   `ai-surface` do the same at 35 and 12.
2. The browser is split over ten features: `browser`, `webviews`, `page-state`, `browser-search`,
   `bookmarks`, `autofill`, `passwords`, `browser-import`, `extensions`, `link-preview`.
   `browser` imports `webviews` in 40 files and `workspace` in 41.
3. `workspace` is a grab bag: 125 flat files, 11.8k lines, imported by 218 files. It holds the tab
   and pane layout engine (`dock*`, `pane*`), tab groups, profile records, window recovery and
   browser URL and search helpers.
4. A Space is split over `spaces`, `library` and `journal` (29k lines), which import each other.
5. `settings` and the features import each other (`agents` 15 and 4, `browser` 7 and 4,
   `extensions`, `recall`, `voice`, `app-shell`), because settings pages live in `settings` and
   reach into feature internals.
6. Server calls are in two places. `src/api/<domain>` holds some, while `ai-surface`, `passwords`,
   `memory-tree`, `recall`, `autofill`, `voice`, `link-preview`, `agent-interventions` and
   `agents/*` have their own `api.ts`.
7. Layer and vague names: 10 `types.ts`, `store/` and `model/` folders inside features, a
   `helpers.ts`. Feature roots hold 125, 87, 75 and 51 files with no subfolders. 144 non-test
   files are over 200 lines and 7 over 300.
8. Tiny features: `collaboration` (34 lines), `connected-devices`, `native-session`,
   `link-preview`, `chat-composer`, `setup`.

## Rules

- Everything for a feature lives in `src/features/<feature>/`: its UI, state, server calls
  (`api/` or `api.ts`), native wrappers, settings section, tests and design note.
- Feature names match the Rust side: `agents`, `browser`, `sync`, `devices`, `voice`, `memory`.
- `src/api/` stays and stays neutral: the HTTP client, base URL and deployment, the saved-copies
  cache and the account event stream. It holds no endpoint of any one feature.
- Folders are kebab-case, components PascalCase. No `types.ts`, `helpers`, `utils`, `store/` or
  `model/`; state sits next to what it serves (`tabs/tabsStore.ts`).
- A feature root holds about 20 files at most. Group the rest into named subfolders.
- Features import each other only through `index.ts`, with no mutual imports. A new test in
  `src/tests/architecture/` fails on a cycle between features.
- Each feature owns its settings section. `settings/` keeps the page, search and preference store.
- Files stay under 200 lines.

## Target layout

```
src/
  app/            window entries, router, window chrome (sidebar, tab strip, Space bar)
  api/            neutral transport: client, deployment, cache, account events
  features/
    agents/       conversations, runs, tools, cursor, plans, workflows, connected-apps, ...
    browser/      pages, page-state, search, bookmarks, autofill, passwords, import, extensions
    app-windows/  tabs, panes, tab-groups, recovery, profiles, navigation-names
    spaces/       chat, library, journal (notes, drawings, day), members, home
    memory/       memory tree, recall, morning brief
    files/        picker, preview, photo editor, link previews
    account/      sign-in, sessions, native-session
    sync/         vault
    devices/      connected devices
    voice/  settings/  shortcuts/  support/  onboarding/  updater/
  native/         raw IPC only
  shared/         ui, hooks, platform, assets
  styles/  tests/
```

## Where each feature goes

| Today | New |
| --- | --- |
| `misty` | `agents/conversations/` (ask engine, composer, context bar) |
| `ai-surface` | `agents/runs/` (invocations, local run events, markdown) |
| `agent-interventions` | `agents/interventions/` |
| `chat-composer` | `spaces/chat/` |
| `agents/localTools` | `agents/tools/` |
| `agents/companion` | `agents/cursor/` |
| `agents/collaboration` | `agents/plans/` (plans, questions, goals) |
| `agents/apps` | `agents/connected-apps/` |
| `agents/screenAct`, `agents/desktop` | `agents/desktop-control/` |
| `agents/folders` | `agents/shared-folders/` |
| `agents/workspace` | `agents/methods/` (name to confirm) |
| `webviews`, `page-state`, `browser-search`, `bookmarks`, `autofill`, `passwords`, `browser-import`, `extensions` | `browser/` subfolders |
| `link-preview` | `files/` |
| `workspace` | `app-windows/` split into `tabs/`, `panes/`, `tab-groups/`, `recovery/`, `profiles/`; URL, search and home helpers go to `browser/` |
| `profiles`, `navigation-names` | `app-windows/` |
| `library`, `journal`, `collaboration` | `spaces/library/`, `spaces/journal/`, `spaces/journal/notes/` |
| `memory-tree`, `recall` | `memory/` |
| `picker`, `editor`, `resource-preview` | `files/` |
| `auth`, `native-session` | `account/` |
| `vault` | `sync/vault/` |
| `connected-devices` | `devices/` |
| `welcome`, `setup` | `onboarding/` |
| `app-shell` | `app/shell/` |
| `native/cloud-clipboard`, `devices`, `sandbox`, `settings-plugins` | `sync/`, `devices/`, `agents/`, `settings/` |
| `shared/navigation`, `src/assets` | merged or removed |

## What happens to `src/api`

`api/` stays. Its neutral layer stays: `client/`, `deployment/`, `cache/`, `account-events*`.
Each domain client moves into its feature, as `<feature>/api/` or a single `api.ts`.

| Today | New |
| --- | --- |
| `api/account/*` | `account/api/` |
| `api/agents/*`, `api/ai/*`, `api/assistant/*` | `agents/api/` |
| `api/runtimeSocket.ts`, `device-models.ts`, `device-memory.ts`, `device-embeddings.ts` | `agents/runs/api/` (they talk to the local runtime) |
| `api/devices/*` | `devices/api/` |
| `api/spaces/*` | `spaces/api/`; the Library transfer policy goes to `spaces/library/api/` |
| `api/notes/*`, `api/journal/*`, `api/drawings/*` | `spaces/journal/` (`notes/api`, `drawings/api`, `api`) |
| `api/preview/*`, `api/local-files.ts` | `files/api/` |

The existing feature-level `api.ts` files (`ai-surface`, `passwords`, `memory-tree`, `recall`,
`autofill`, `voice`, `link-preview`, `agent-interventions`, `agents/apps`, `agents/grants`,
`agents/collaboration`) travel with their features and already follow this rule. The API README
(`src/api/README.md`) keeps its rules on `apiRequest`, `spaceRequest` and the cache; update its
layer list as clients move.

## Phases

Mostly moves; the `@/` aliases make import rewriting scriptable. Do it on a quiet branch (other
sessions edit `src` at the same time). After every step run `tsc`, lint, the tests and
`vite build`.

1. Move the domain clients out of `src/api` into their features.
2. Consolidate `browser/`.
3. Split `workspace` into `app-windows/`.
4. Merge `misty` and `ai-surface` into `agents/`; rename the agent subfolders.
5. Consolidate `spaces/`.
6. Move the settings sections into their features.
7. Merge the tiny features.
8. Rename files, split the long ones, and add the cycle test.

## Decisions

- The names in this plan are agreed.
- `settings/` keeps only the page, search and preference store. A section that belongs to no
  feature, or does nothing, is deleted, not kept.
- The weather tool was removed (2026-11-07): agents use web search for it.
