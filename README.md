# Misty

Misty is a Tauri application with one desktop React interface for desktop, iPad, and Android tablets, plus a Rust core and an embedded direct cloud-storage library. Phone-sized iOS and Android devices are not supported.

## Repository layout

- `src/` — React application, shared desktop/tablet layout, stores, and frontend services.
- `src/features/` — human-owned product areas. Start here for feature work:
  - `explorer/` — Files/Explorer browser, sidebars, toolbars, inspector, library workspace, drag/drop, search, and Explorer store internals.
  - `spaces/` — Spaces shell, chat, library, tasks, members, settings, utilities, and tests.
- `src/pages/` — thin route wrappers and legacy route entrypoints. Product implementation should live in `src/features/`.
- `src/components/ui/` — shared shadcn/Radix primitives and small generic UI compositions.
- `src/services/misty-api/` — frontend API and Tauri bridge types/functions. `src/api/` is a compatibility re-export layer.
- `src/stores/` — cross-feature Zustand stores only. Feature-specific state should live with its feature.
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

New hand-written source is limited to 500 lines. Existing larger files are frozen at their recorded ceilings and must leave the fixture baseline after they are split below the limit.

## Generated-file cleanup

```sh
misty-cli desktop clean
misty-cli desktop clean --apply
```

Cleanup targets only generated web, Rust, native-platform, design-QA, cache, and `.DS_Store` files. It skips in-use directories and never removes environment/signing files, dependencies, or tracked platform sources.
