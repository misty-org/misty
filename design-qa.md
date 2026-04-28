# Home V1 design QA

Result: passed

## Compared artifacts

- Reference: `design-references/home-v1/home-v1-reference-1440x1024.png`
- Implementation: `design-references/home-v1/home-v1-implementation.png`
- Side-by-side: `design-references/home-v1/home-v1-comparison.png`
- Viewport: 1440 × 1024

## Visual review

- Hierarchy matches the approved direction: greeting, Your Spaces, Today and Important, then the cross-Misty composer.
- Home is separated above the Space avatars in the primary rail. Activity, Settings, and Profile form the bottom group.
- The implementation uses Misty charcoal surfaces, semantic borders, cream text, existing typography, shadcn cards/dialog/input grouping, and Lucide icons.
- Density stays deliberately quiet: four Space cards at wide widths, up to four rows per middle card, short empty states, and one search surface.
- Responsive grids collapse to two and one columns without horizontal overflow.

The browser comparison shows the authenticated empty state because the local visual-QA session had no live Space snapshot. The populated Space, agenda, and Important rows use the same measured card geometry and are covered by component tests. Native logo resolution and Space avatars remain runtime/server-provided rather than mocked in production code.

## Interaction review

- Home route and rail link open correctly.
- Activity opens from the bottom rail and preserves keyboard focus on close.
- Search submits by Enter or arrow button, opens an accessible result dialog, updates while typing, and reports local/server status.
- Search results navigate to Spaces, tasks, chat, Library, agents/workflows, and reveal device files in the Explorer when possible.
- Create task opens the newest Space's task composer, or Space creation when no Space exists.

## Severity check

- P0: none
- P1: none
- P2: none

## Deferred product capability

V1 is retrieval and navigation, not a generated RAG answer. Full historical message search, global note-body embeddings, and cited LLM answers require a permission-filtered account-wide server search contract.
