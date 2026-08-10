# Misty

Misty is a React product with a native Tauri shell for desktop, iPad, and Android tablets, plus a Rust core and an embedded direct cloud-storage library. Its browser build is a server-backed companion: it provides Spaces and account flows while clearly gating local-device features. Phone-sized iOS and Android devices are not supported.

## Repository layout

- `src/app/` — bootstrap, routing, layouts, providers, telemetry lifecycle, and error boundaries.
- `src/features/` — product-owned UI, hooks, types, and Zustand state. A feature exposes its intentional public API from `index.ts` and owns its implementation details.
- `src/api/` — remote Misty HTTP client and resource-specific API modules.
- `src/native/` — small shared Tauri/OS integrations. Desktop-only filesystem IPC lives with the Files feature at `src/features/files/native.ts`.
- `src/telemetry/` — error reporting and product telemetry.
- `src/shared/` — generic UI, hooks, utilities, drag infrastructure, and assets with no feature or native-runtime knowledge.
- `src/styles/` — global styling and design tokens.
- `src/tests/` — test setup and architecture contracts only; behavior tests are colocated with their source.
- `src-tauri/` — Rust desktop application and tracked iOS/Android platform projects. Its source is layered as `app/` (Tauri commands/runtime), `domain/` (business models and workflows), `infra/` (storage, network, OS adapters), `platform/` (Tauri and desktop integration), and `telemetry/`.
- `src-tauri/src/infra/direct_cloud.rs` — native Google Drive, Dropbox, and Microsoft OneDrive client runtime.
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
npm run dev:web
npm run build:desktop
npm run build:mobile
npm run build:android
npm run build:web
misty-cli desktop windows stage-assets
```

The web build requires `VITE_MISTY_PUBLIC_API_URL` to point at the public
Misty API base (for example, `https://mistysys.com/api`). The browser sends
the server's HttpOnly session cookie with credentialed API requests; it does
not persist the desktop bearer token. The API must explicitly allow the web
origin, such as `https://app.mistysys.com`.

## Cloudflare Pages

The Pages project is declared in `wrangler.jsonc` as `misty-web-app`; it serves
the web build's `dist/` output. Connect this repository to Cloudflare Pages
with Git integration, then configure:

- Production branch: your default branch.
- Build command: `npm run build:web`.
- Build output directory: `dist`.
- Build environment variable: `MISTY_PUBLIC_API_URL=https://mistysys.com/api`.
- Custom domain: `app.mistysys.com`.

Cloudflare Pages produces preview deployments for pull requests automatically.
The production API must allow `https://app.mistysys.com` in
`MISTY_ALLOWED_ORIGINS`; see the Misty Server production environment template.

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
