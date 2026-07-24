# Backlog: Agents / Studio / Workflows (post-2026-07-27 beta)

## What's here

- `pages/Agents/AgentCenter.tsx` — Space-level custom Agent management UI.
- `pages/Studio/*` — Agent architecture editor, workflow editor, and the agent
  direct-message conversation panel.
- `features/workflows/*` — workflow template/provider/v2 data model.
- `models/types/pages/Agents`, `models/types/pages/Studio`,
  `models/types/features/workflows`, `models/interfaces/features/workflows` —
  the type-surface mirrors for the files above (this codebase keeps a parallel
  `models/types` / `models/interfaces` file per feature file; they moved in
  lockstep with their implementations).
- `tests/workflows/*.test.ts` — unit tests for `features/workflows`.

## Why it's here

Cut from beta scope on 2026-07-27 to ship a focused product loop: a Space
(Library, Chat, Members) plus a global Assistant (Mika) surface, with
`@Mika` as the lightweight in-chat AI bridge. Agents, Workflows, Studio,
Automations, and Tasks-as-a-tab were pruned from the beta UI to keep the
initial release simple. **Not abandoned** — the direction is Mika-first for
now, with Agents/Workflows potentially returning after user validation of
the simpler product.

## Constraint: this code does not build

`tsconfig.json`'s `"include"` is `["src"]` only. This directory is a sibling
of `src/`, not inside it, so nothing here is typechecked or bundled.
**Nothing remaining in `src/` may import from this directory** — that
invariant is what makes it safe to leave stale here indefinitely without
breaking `npm run typecheck` / `npm run build:desktop`.

## Restoring this feature

1. Move the relevant files back under `src/` (reversing the paths above).
2. Re-wire the cut import points, listed below in the order they were cut:
   - `src/features/spaces/index.tsx` — re-add the `AgentCenter` import and the
     `section === "agents"` / `section === "studio"` render branches that were
     removed from `SpaceDetail`.
   - `src/features/spaces/SpaceChat.tsx` (and its mirror
     `src/models/types/features/spaces/SpaceChat.ts`) — re-add the
     `AgentConversationPanel` import and the `agentId` / `agentConversationId`
     query-param branch that rendered a direct agent conversation.
   - `src/features/spaces/components/SpacePanelContent.tsx` — re-add the
     Agents sidebar section (per-agent conversation links) and the
     `agentArchitectureApi.conversations()` fetch that fed it; re-add
     `"agents"` / `"studio"` to `validSections` and `validSettingsSections`;
     re-add the Studio/Agents settings sub-tab links.
   - `src/features/spaces/components/SpaceSettings.tsx` — re-add the Studio
     settings card and Agents management block, and the `loadStudio` calls
     that populated them.
   - `src/features/spaces/components/SpaceSectionNavigation.tsx` — re-add the
     `agents` tab entry (and decide whether `tasks` should also become a
     top-level tab again, since it was hidden from nav but its code was never
     removed from `src/`).
   - `src/routing/routeConfig.tsx` — replace the `/agents`, `/automations`,
     `/studio*` redirects with real routes again if a top-level Studio
     surface returns.
3. Re-run `npm run typecheck`, `npm run test`, and `npm run build:desktop` to
   catch drift accumulated while this code was shelved — it was not
   maintained during the beta.

## Known state as of move

Moved from `src/` at commit `7b8fcbd5` (2026-07-19), as part of the
2026-07-27 beta prune. No functional changes were made to this code during
the move — only relocation and updating the import sites listed above.
