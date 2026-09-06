# Misty

Misty is a React product with native Tauri shells for desktop and Apple mobile devices, plus a Rust core and an embedded direct cloud-storage library. Desktop keeps the split-panel workspace; the universal iPhone/iPad app projects the same tabs into a touch-first, single-surface shell. Its browser build uses cloud-backed features while gating local-device capabilities. Android tablet packaging remains available, but Android phone hardening is outside the current mobile release.

## Repository layout

- `src/application/` — bootstrap, routing, layouts, providers, telemetry lifecycle, and error boundaries.
- `src/features/` — product-owned UI, hooks, types, and Zustand state. A feature exposes its intentional public API from `index.ts` and owns its implementation details.
- `src/api/` — neutral authenticated Misty client and domain-specific endpoint modules. Space-only connectivity policy remains inside `src/api/spaces/`.
- `src/native/` — small shared Tauri/OS integrations. Desktop-only filesystem IPC lives with the Files feature at `src/features/files/native.ts`.
- `src/telemetry/` — error reporting and product telemetry.
- `src/shared/` — generic UI, hooks, utilities, drag infrastructure, and assets with no feature or native-runtime knowledge.
- `src/styles/` — global styling and design tokens.
- `src/tests/` — test setup and architecture contracts only; behavior tests are colocated with their source as `*.test.ts` or `*.test.tsx` rather than placed in `__tests__` folders.
- `src-tauri/` — Rust desktop application and tracked iOS/Android platform projects. Its source is layered as `app/` (Tauri commands/runtime), `domain/` (business models and workflows), `infra/` (storage, network, OS adapters), `platform/` (Tauri and desktop integration), and `telemetry/`.
- `src-tauri/src/infra/direct_cloud.rs` — native Google Drive, Dropbox, and Microsoft OneDrive client runtime.
- `src/tests/contracts/` — executable architecture, source-size, readability, and UI contracts.

## Setup

Desktop Browser tabs use Tauri child WebViews and the operating system's WebView runtime: WebKit on macOS and Linux, and WebView2 on Windows. Misty does not download or bundle a separate browser engine. Linux development and CI require the WebKitGTK 4.1 development packages for the distribution.

From the repository root:

```sh
npm ci
```

The optional `misty` developer CLI now lives in the separate
`misty-org/misty-cli` repository.

## Common commands

```sh
npm run dev
npm run dev:mobile
npm run dev:web
npm run tauri -- build
npm run build:mobile
npm run build:android
npm run build:web
```

The Store synchronizes its product-neutral extension contract and shared
artwork/verification primitives from the adjacent `misty-apps/interface`
directory before every development or build target. If the repositories are not
adjacent, set `MISTY_STORE_DIR`; otherwise the synchronizer reads the
published interface from GitHub. Run `npm run check:extension-interface` to
detect drift without changing generated files.

The web build requires `MISTY_PUBLIC_API_URL` to point at the public
Misty API base (for example, `https://api.mistysys.com/v1`). The browser sends
the server's HttpOnly session cookie with credentialed API requests; it does
not persist the desktop bearer token. The API must explicitly allow the web
origin, such as `https://app.mistysys.com`.

## Cloudflare Workers

The Worker is declared in `wrangler.jsonc` as `misty-web-app`; it serves the web
build's `dist/` output as static assets and falls back to `index.html` for SPA
routes. Connect this repository to Cloudflare Workers Builds, then configure:

- Production branch: your default branch.
- Root directory: `.`.
- Build command: `npm run build:web`.
- Deploy command: `npx wrangler deploy`.
- Build environment variable: `MISTY_PUBLIC_API_URL=https://api.mistysys.com/v1`.
- Custom domain: `app.mistysys.com`.

Once the Git repository is connected in Workers Builds, every push to the
production branch builds and deploys the browser companion automatically.
Preview branches can use the same build with a preview API endpoint when one
is available.

The separate `dev` Wrangler environment deploys as `misty-web-app-dev` on
`dev-app.mistysys.com`. Build it against the development API and deploy it with:

```sh
MISTY_PUBLIC_API_URL=https://dev-api.mistysys.com/v1 npm run deploy:web:dev
```

For automatic development deployments, connect `misty-web-app-dev` to the
development branch in Workers Builds with the same root and build command,
set `MISTY_PUBLIC_API_URL=https://dev-api.mistysys.com/v1`, and use
`npx wrangler deploy --env dev` as the deploy command.

The production API must allow `https://app.mistysys.com` in
`MISTY_ALLOWED_ORIGINS`; see the Misty Server production environment template.
The development API must likewise allow `https://dev-app.mistysys.com`.

Use the Tauri desktop runner when you need native app behavior:

```sh
npm run tauri -- dev
```

For side-by-side local auth/session testing, start one Tauri instance per profile in separate terminals:

```sh
misty desktop dev --profile owner
misty desktop dev --profile collaborator
```

Each profile gets a separate app identifier, browser storage, and auth vault entry. The launcher also creates `~/.misty/cli/profiles/<profile>` for development-only session metadata, while Misty's normal files, notes, cache, and database stay rooted in `~/.misty`.

The existing `mobile` build mode is the universal iOS packaging target for iPhone and iPad on iOS 15+. It mounts `MobileLayout`, preserves desktop pane and virtual-window state, and presents one active workspace surface at a time. Downloadable extensions and the Store are desktop-only. Android packages currently retain their existing tablet-oriented packaging constraints.

Browser agent access is device-local and opt-in per tab. Selecting an Agent creates a visible, revocable eight-hour grant for inspect, navigate, click, and download-status tools; grants never survive an app restart. External pages receive no Tauri API permissions, and downloads are assigned collision-safe names in the operating system Downloads folder by the native WebView handler.

Desktop cleanup, icons, Windows staging, and manual releases are owned by the
separate `misty-cli` repository. Its Apple-first mobile commands cover Xcode
readiness, device discovery, setup, development, device runs, simulator builds,
and signed exports. Run `misty mobile --help` for the complete option reference.
Android's native project remains available through the standard Tauri CLI.

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
misty desktop clean
misty desktop clean --apply
```

Cleanup targets only generated web, Rust, native-platform, design-QA, cache, and `.DS_Store` files. It skips in-use directories and never removes environment/signing files, dependencies, or tracked platform sources.
