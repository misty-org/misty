# Misty

Misty is a Tauri application with one desktop React interface for desktop, iPad, and Android tablets, plus a Rust core and an embedded direct cloud-storage library. Phone-sized iOS and Android devices are not supported.

## Repository layout

- `src/app/` — bootstrap, routing, layouts, providers, telemetry lifecycle, and error boundaries.
- `src/pages/` — thin route composers. Product behavior belongs to a feature.
- `src/features/` — product-owned UI, hooks, types, and Zustand state. Spaces is split into `spaces`, `space-chat`, `space-library`, `space-members`, `space-planner`, `space-roadmap`, and `space-connections`; Files is split into `file-explorer`, `file-search`, and `file-preview`.
- `src/services/` — the only frontend network boundary. Shared HTTP behavior lives in `http.ts`; Spaces endpoints and DTOs are grouped under `services/spaces/`.
- `src/shared/` — generic UI, hooks, utilities, drag infrastructure, platform bridges, and assets with no feature knowledge.
- `src/styles/` — global styling and design tokens.
- `src/tests/` — test setup and architecture contracts only; behavior tests are colocated with their source.
- `src-tauri/` — Rust application core and tracked iOS/Android platform projects.
- `src-tauri/src/services/direct_cloud.rs` — native Google Drive, Dropbox, and Microsoft OneDrive client runtime.
- `src/tests/contracts/` — executable architecture, source-size, readability, and UI contracts.

## Setup

```sh
git submodule update --init --recursive
npm install
```

The storage build compiles the narrow direct-provider adapter into the Rust target directory.

## Common commands

```sh
npm run dev:desktop
npm run dev:mobile
npm run build:desktop
npm run build:mobile
npm run build:android
misty-cli desktop windows stage-assets
```

Use the Tauri desktop runner when you need native app behavior:

```sh
misty-cli desktop dev
```

For side-by-side local auth/session testing, start one Tauri instance per profile in separate terminals:

```sh
misty-cli desktop dev --profile owner
misty-cli desktop dev --profile collaborator
```

Each profile gets a separate app identifier, browser storage, and auth vault entry. The launcher also creates `~/.misty/.profiles/<profile>` for profile-scoped session metadata, while Misty's normal files, assets, remotes, cache, and database stay rooted in `~/.misty`.

The `mobile` build mode is the native iPad packaging target; it uses the same component tree and layout as desktop. Android packages require a 600dp smallest screen width, and the iOS target is restricted to the iPad device family.

Desktop development, cleanup, icons, Windows staging, and manual releases are owned by `misty-cli`. Tauri's native iOS and Android projects remain available through the standard Tauri CLI.

## Quality checks

```sh
npm run check:format
npm run check
cd src-tauri && cargo fmt --check && cargo check && cargo test
```

`npm run format` formats frontend source with Prettier. Vitest enforces the repository's readability, source-size, and UI architecture contracts.

All hand-written frontend source is limited to 500 lines. Lint findings and frontend file-size exceptions have no migration baseline.

## Generated-file cleanup

```sh
misty-cli desktop clean
misty-cli desktop clean --apply
```

Cleanup targets only generated web, Rust, native-platform, design-QA, cache, and `.DS_Store` files. It skips in-use directories and never removes environment/signing files, dependencies, or tracked platform sources.
