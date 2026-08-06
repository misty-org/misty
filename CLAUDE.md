# Misty Desktop — Codebase Guide

Tauri + React + TypeScript desktop app. The Go backend lives in the sibling repo
`misty-server`.

## Where things go

```
src/
  app/            Bootstrap only. main.tsx, App.tsx, router, root layout,
                  providers, error boundaries. Nothing feature-specific.
  pages/          Thin route components. A page composes features and owns
                  layout — never business logic, never fetch calls.
  features/       Vertical slices. Each feature owns its UI, state, and types.
  services/       The HTTP boundary. All network access lives here.
  shared/         Cross-cutting code with no feature knowledge.
    ui/           Design-system primitives (Radix wrappers, buttons, dialogs).
    hooks/        Generic React hooks.
    lib/          Pure utilities.
    platform/     Tauri bridge, build-target detection.
  styles/         Global CSS.
  tests/          Only setup.ts and contracts/. Everything else is colocated.
```

### Anatomy of a feature

```
features/<feature>/
  components/     Feature-specific React components.
  hooks/          Feature-specific hooks.
  store.ts        Zustand slice — state and actions only. No fetch.
  api.ts          Thin wrapper over services/ for this feature.
  types.ts        Feature-local types.
  index.ts        The feature's public surface. Other features import ONLY this.
```

If a feature grows past roughly 40 files, it is probably two features.

## Import direction

Dependencies point one way. This is enforced by ESLint (`no-restricted-imports`)
and by `src/tests/contracts/`.

```
app  →  pages  →  features  →  services  →  shared
                      ↓                        ↑
                      └────────────────────────┘
```

- `shared/` imports nothing from `app`, `pages`, `features`, or `services`.
- `services/` imports only from `shared/`.
- `features/` import from `services/` and `shared/`.
- A feature importing another feature must go through its `index.ts`.
  Deep imports (`@/features/spaces/components/Foo`) are a lint error.
- `pages/` import from `features/` and `shared/`.
- Only `app/` may import from everywhere.

## Naming

| Thing | Convention | Example |
|---|---|---|
| Directories | `kebab-case` | `features/space-chat/` |
| Components | `PascalCase.tsx` | `SpaceChat.tsx` |
| Hooks, utils, stores | `camelCase.ts` | `useSpaceMessages.ts` |
| Types files | `types.ts` | `features/spaces/types.ts` |
| Tests | beside the source | `SpaceChat.test.tsx` |

There is no `desktop/` or `mobile/` directory split. Platform differences are
handled at runtime via `shared/platform/buildTarget.ts`.

## File size

Soft limit **200 lines**, hard cap **500** (enforced by
`src/tests/contracts/sourceSize.contract.test.ts`).

When a file gets too big, extract a **named concept** — a component, a hook, a
domain module. Never split mechanically by function name into
`thing_someFunction.ts`. A split that doesn't produce a name you'd say out loud
is the wrong split.

## Types

Types live with the code that owns them.

- Props used by one component → declare them in that component's file.
- Types shared across a feature → `features/<feature>/types.ts`.
- Backend request/response shapes → `services/<domain>.ts`.
- Genuinely global types → `shared/types.ts`.

Do not create a parallel type tree. (The old `src/models/` mirror was removed
for exactly this reason — it forced you to open three files to read one
component.)

## State and data fetching

Zustand stores hold state and actions. They do **not** call `fetch`.

All network access goes through `src/services/`:

```ts
// services/http/client.ts — auth, base URL, correlation IDs, error mapping
// services/spaces.ts      — typed request functions + DTOs
```

A store calls a service function and stores the result. This keeps stores small
and makes the backend surface greppable in one directory.

## Commands

```bash
npm run dev          # Vite dev server (does NOT typecheck)
npm run tauri dev    # the real desktop shell — verify UI here, not the bare Vite port
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm test             # vitest
npm run check        # format + typecheck + test + audit — run before committing
```

`npm run dev` alone will not catch type errors. Always verify against the Tauri
shell.

## Adding a feature — checklist

1. `src/features/<kebab-name>/` with `index.ts`.
2. Backend calls go in `src/services/<domain>.ts`, not in the feature.
3. Route added in `src/app/routing/`, page in `src/pages/` stays thin.
4. Tests colocated.
5. `npm run check` green.
