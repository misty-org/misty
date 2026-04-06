# Misty

Misty is a Tauri application with one desktop React interface for desktop, iPad, and Android tablets, plus a Rust core and an embedded rclone storage library. Phone-sized iOS and Android devices are not supported.

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
- `service/rclone/` — pinned upstream rclone submodule. Misty changes live in `service/patches/`.
- `scripts/` — builds, security checks, smoke tests, size enforcement, and safe cleanup.

## Setup

```sh
git submodule update --init --recursive
npm install
```

The storage build validates the pinned rclone commit, copies it into the ignored Rust target directory, applies Misty's patches there, and leaves the submodule clean.

## Common commands

```sh
npm run dev:desktop
npm run dev:mobile
npm run build:desktop
npm run build:mobile
npm run build:android
npm run service:archive
npm run windows:stage-assets
```

The `mobile` build mode is the native iPad packaging target; it uses the same component tree and layout as desktop. Android packages require a 600dp smallest screen width, and the iOS target is restricted to the iPad device family.

For a native Windows NSIS or MSI test build, including the temporary asset-copy workflow, see [docs/windows-build.md](docs/windows-build.md).

Platform release commands, signing preflights, simulator smoke tests, macOS notarization, and Android security checks are listed in `package.json`.

## Quality checks

```sh
npm run check:format
npm run check:readability
npm run check
npm run security:mobile:audit
npm run security:android:audit
cd src-tauri && cargo fmt --check && cargo check && cargo test
```

`npm run format` formats frontend source with Prettier. `npm run check:readability` rejects newly compacted source lines over 160 characters, with narrow exceptions for comments, URLs, and data literals.

`npm run check:size` limits new hand-written source and scripts to 500 lines. Existing larger files are frozen at their recorded ceilings and must leave the baseline after they are split below the limit.

## Generated-file cleanup

```sh
npm run clean:preview
npm run clean
```

Cleanup targets only generated web, Rust, native-platform, design-QA, cache, and `.DS_Store` files. It skips in-use directories and never removes environment/signing files, dependencies, tracked platform sources, or the rclone submodule.
