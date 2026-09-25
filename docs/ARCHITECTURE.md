# Misty Architecture & Engineering Handbook

> **Target Audience**: New engineers, contributors, and teams onboarding to Misty.  
> **Goal**: Enable full onboarding within 2–3 hours. Ensure any engineer instantly knows where every symbol, component, state store, API endpoint, or native bridge belongs.

---

## 1. System Overview

Misty is an integrated goal-oriented workspace application built with:
- **Frontend**: React 19, TypeScript, Tailwind CSS, Vite, and Zustand.
- **Desktop & Mobile Shell**: [Tauri v2](https://tauri.app) with native platforms for macOS, iOS, Android, and Windows.
- **Native Core**: Rust (`src-tauri/`) handling direct cloud storage (Google Drive, Dropbox, OneDrive), child webviews, local filesystem operations, and IPC.
- **Extensions / Apps**: Sandboxed mini-apps and plugins communicating strictly over `@misty/sdk`.

### Core Mental Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      APPLICATION SHELL (src/app/)                   │
│         Windowing, Tab Management, Route Configuration, Layouts             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌──────────────────────────────────────┐        ┌─────────────────────────────┐
│     PRODUCT FEATURES (src/features/) │        │     SANDBOXED APPS (apps/)  │
│  Files, Code, Terminal, Journal,     │        │  Third-party plugin panels, │
│  Planner, Library, Inbox, Agents,    │        │  Discover catalog packages, │
│  Spaces, Auth, Settings              │        │  isolated web extensions    │
└──────────────────┬───────────────────┘        └──────────────┬──────────────┘
                   │                                           │
                   ├───────────────────────────┬───────────────┘
                   ▼                           ▼
┌──────────────────────────────────────┐ ┌────────────────────────────────────┐
│      SHARED PRIMITIVES (src/shared/) │ │       API CLIENT (src/api/)        │
│  Design system UI (buttons, cards),  │ │  Pure HTTP & WebSocket client,     │
│  generic hooks, utilities            │ │  wire DTOs (NO React / UI imports) │
└──────────────────┬───────────────────┘ └────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       NATIVE SYSTEM (src/native/ & src-tauri/)              │
│       Tauri IPC commands, Rust cloud storage, FS, OS child WebViews         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Hierarchy Map

```text
misty/
├── src/                                  # Main Application Source
│   ├── app/                              # Global App Shell & Composition
│   │   ├── layouts/                      # DesktopLayout, MobileLayout, shared headers
│   │   ├── routing/                      # App router, deep links, route configuration
│   │   └── providers/                    # Top-level React context providers
│   ├── features/                         # Core Product Workspaces & Domains
│   │   ├── files/                        # File Explorer, previews, transfers, search
│   │   ├── browser/                      # Web Browser workspace, bookmarks, omnibox
│   │   ├── code/                         # Code editor, multi-buffer, LSP transport
│   │   ├── terminal/                     # Terminal emulator, SSH, local sessions
│   │   ├── journal/                      # Notes, Notebooks, collaborative Drawings
│   │   ├── planner/                      # Space planner, tasks, roadmaps, agenda
│   │   ├── library/                      # Space Library, cloud storage connectors
│   │   ├── inbox/                        # Mail client, threads, activity feed
│   │   ├── agents/                       # Native & cloud AI agents, interventions
│   │   ├── spaces/                       # Collaborative Space management, chat, members
│   │   ├── auth/                         # Authentication, account sessions, tokens
│   │   ├── marketplace/                  # Discover app store UI & installation flows
│   │   └── settings/                     # User preferences, themes, keybindings
│   ├── api/                              # Neutral HTTP & WebSocket API Layer
│   │   ├── client/                       # Base HTTP client, session auth, retry logic
│   │   ├── spaces/                       # Space domain endpoints & wire DTOs
│   │   └── <domain>/                     # Domain-specific backend endpoints
│   ├── shared/                           # Reusable, Domain-Agnostic Primitives
│   │   ├── ui/                           # Design System (Button, Card, Dialog, Input, etc.)
│   │   ├── hooks/                        # Generic hooks (useDebounce, usePinnedIds, etc.)
│   │   ├── lib/                          # Utility functions (date formatting, math, strings)
│   │   └── assets/                       # Global brand icons and common artwork
│   ├── native/                           # Frontend Tauri IPC Bridges
│   │   ├── filesystem.ts                 # Native OS filesystem operations
│   │   └── runtime.ts                    # Platform checks and OS capabilities
│   ├── styles/                           # Global CSS and Tailwind directives
│   └── tests/                            # Architecture contracts & test harnesses
│
├── apps/                                 # Sandboxed Apps & Plugin Ecosystem
│   ├── catalog/                          # Public catalog metadata & app registry
│   ├── extensions/                       # Installable plugin manifests & bundles
│   │   ├── quick_convert/                # Media conversion plugin
│   │   ├── ytdlp/                        # Video downloader plugin
│   │   └── themes/                       # Community theme bundle
│   ├── interface/                        # Shared catalog presentation primitives
│   └── src/                              # Web plugin bridge runtime
│
├── packages/                             # Workspace NPM Packages
│   ├── sdk/                              # @misty/sdk: Public SDK for apps & plugins
│   └── contracts/                        # @misty/contracts: RPC wire definitions
│
├── src-tauri/                            # Rust Core & Native Host
│   ├── src/
│   │   ├── app/                          # Tauri commands and entry point
│   │   ├── domain/                       # Core domain models and workflows
│   │   ├── infra/                        # Cloud storage adapters (Drive, Dropbox)
│   │   └── platform/                     # Native WebViews, permissions, sandboxing
│   ├── capabilities/                     # Tauri v2 security capabilities
│   └── Cargo.toml
│
└── docs/                                 # Architecture & Product Documentation
```

---

## 3. The 6 Golden Architectural Rules

### Rule 1: Physical Matches Logical (No Path Alias Deception)
- Every file imported via `@/features/<feature>/...` must physically live at `src/features/<feature>/...`.
- Never introduce proxy bounce files (files that merely re-export another file) to simulate a directory structure that does not exist.
- Never use TypeScript `paths` or Vite aliases to masquerade one directory as another.

### Rule 2: Component Colocation (Props, Styles, and Subcomponents)
- A component file (`Button.tsx`, `ChatMessageRow.tsx`) owns its own TypeScript `Props` interface at the top of the file.
- **Never create isolated single-interface files** like `model/interfaces/components/Foo.ts`.
- **Never split a component into `Foo.tsx` and `FooView.tsx`** unless there is a genuine architectural boundary (e.g. cross-platform native rendering). Standard components handle both state and presentation directly, or delegate state to a colocated custom hook (`useFoo.ts`).

### Rule 3: Single-File Stores
- A Zustand store belongs in a single file: `store/use<Name>Store.ts`.
- The state interface, initial state, actions, and the `use<Name>Store` hook belong together in that single file.
- Do not fracture a store into `types/`, `interfaces/`, `actions/`, and `store/` across 5 files.

### Rule 4: Clean API Boundary (No UI in `src/api`)
- `src/api/` is strictly for backend communication: HTTP fetches, WebSocket streams, and wire DTOs.
- `src/api/` **must never import React**, JSX, or UI component props.
- If a component needs a prop shape, that shape belongs with the component in `src/features/`, not in `src/api/`.

### Rule 5: Standard React Composition Over Factory Pipelines
- Author components as standard React components and hooks.
- Avoid higher-order factory functions (`createFooWorkspace(services)`) that pass dictionaries of 20+ callbacks down closure trees. Use React Context or standard hook imports instead.

### Rule 6: Transparent Stubs & Status
- Never hide an unfinished feature behind a silent fallback or a buried `Err("not implemented")` in runtime code.
- If a feature is incomplete or platform-gated, explicitly feature-flag it or render a clear `<EmptyState>` or `<PermissionState>` explaining the requirement.

---

## 4. Where Does My Code Go? (Decision Tree)

| I am adding or modifying... | Location | Example |
| :--- | :--- | :--- |
| A reusable design system control (no domain knowledge) | `src/shared/ui/` | `src/shared/ui/badge.tsx` |
| A generic React hook with no product feature logic | `src/shared/hooks/` | `src/shared/hooks/useDebounce.ts` |
| A pure data utility (strings, dates, arrays) | `src/shared/lib/` | `src/shared/lib/formatDate.ts` |
| A screen, tab, panel, or modal for a product feature | `src/features/<feature>/components/` | `src/features/files/components/FileGrid.tsx` |
| Feature-specific state and actions | `src/features/<feature>/store/` | `src/features/inbox/store/useInboxStore.ts` |
| A backend API endpoint or fetch function | `src/api/<domain>/` | `src/api/spaces/api.ts` |
| Desktop windowing, tabs, or top-level layout | `src/app/layouts/` | `src/app/layouts/DesktopLayout/` |
| A new route or URL deep link | `src/app/routing/` | `src/app/routing/routeConfig.tsx` |
| A Tauri IPC command or native bridge | `src/native/` (TS) & `src-tauri/src/app/` (Rust) | `src/native/filesystem.ts` |
| An installable 3rd-party plugin or extension | `apps/extensions/<plugin>/` | `apps/extensions/ytdlp/` |

---

## 5. Feature Anatomy Standard

Every feature in `src/features/<feature>/` follows this uniform structure:

```text
src/features/notes/
├── index.ts               # Public API boundary (exports only what other features need)
├── components/            # UI components (Props defined in each component file)
│   ├── NoteList.tsx
│   ├── NoteEditor.tsx
│   └── NoteCard.tsx
├── hooks/                 # Feature-specific hooks
│   └── useNoteSync.ts
├── store/                 # Zustand store (State, actions, hook in one file)
│   └── useNotesStore.ts
└── types.ts               # Feature domain types (Note, Notebook, NoteFilter)
```

### Public API Boundary (`index.ts`)
Each feature exposes an `index.ts`. External callers (such as `src/app/`) import from `@/features/<feature>`, keeping internal helper components private:

```typescript
// src/features/notes/index.ts
export { NoteEditor } from "./components/NoteEditor";
export { useNotesStore } from "./store/useNotesStore";
export type { Note, Notebook } from "./types";
```

---

## 6. Development & Onboarding Workflow

### First-Time Setup

```bash
# 1. Clone repository
git clone https://github.com/misty-org/misty.git
cd misty

# 2. Install dependencies (builds packages/sdk automatically)
npm ci

# 3. Verify TypeScript compiles cleanly
npm run typecheck

# 4. Start Desktop dev server
npm run dev
```

### Running Platform Targets

| Target | Command | Notes |
| :--- | :--- | :--- |
| **Desktop (macOS / Linux / Windows)** | `npm run dev` | Launches Vite with Tauri IPC bindings |
| **Web Browser Companion** | `npm run dev:web` | Gates native-only capabilities |
| **Mobile (iOS / iPadOS)** | `npm run dev:mobile` | Single-surface touch layout |
| **Android Tablet** | `npm run dev:android` | Tablet packaging target |

### Running Tests

```bash
# Run unit tests
npm test

# Run tests for a specific feature
npx vitest run src/features/notes

# Run architecture contracts
npx vitest run src/tests/contracts
```

---

## 7. Common Recipes

### Recipe A: Adding a New Shared UI Component
1. Create `src/shared/ui/<name>.tsx`.
2. Define props at the top of the file using Tailwind CSS / CVA variants.
3. Export the component and its props from `src/shared/ui/<name>.tsx`.
4. Add `export * from "./<name>";` to `src/shared/ui/index.ts`.
5. *Never create a separate `model/` or `View` file.*

### Recipe B: Adding a Feature Zustand Store
1. Create `src/features/<feature>/store/use<Feature>Store.ts`.
2. Define the interface and implementation in the same file:
   ```typescript
   import { create } from "zustand";

   interface FeatureState {
     items: string[];
     loading: boolean;
     addItem: (item: string) => void;
   }

   export const useFeatureStore = create<FeatureState>((set) => ({
     items: [],
     loading: false,
     addItem: (item) => set((state) => ({ items: [...state.items, item] })),
   }));
   ```

### Recipe C: Calling a Backend Endpoint
1. Define the wire DTO in `src/api/<domain>/types.ts`.
2. Add the endpoint caller in `src/api/<domain>/api.ts` using the authenticated `request` client from `src/api/client`.
3. Call the API from your feature's store or hook.
4. *Do not import React or component prop types into `src/api/`.*
