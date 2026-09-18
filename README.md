# Misty

Misty is a workspace for people, apps, and agents. The React 19 frontend runs in a Tauri desktop/mobile shell. Downloadable apps use the public Misty SDK to access scoped host capabilities.

## Start developing

Install Node.js **24.12+**, npm **11+**, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system. Linux needs WebKitGTK 4.1; Apple mobile development needs Xcode.

```sh
git clone https://github.com/misty-org/misty.git
cd misty
cargo install --path cli --locked
misty setup
misty desktop dev
```

One clone contains the frontend, native shell, first-party apps, SDK, contracts, and CLI. There are no Git submodules or sibling SDK/app checkouts to install. `misty setup` installs the root lockfile and builds the workspace SDK packages. Run `misty --help` to explore commands. Without installing the binary, use `cargo run --manifest-path cli/Cargo.toml -- <command>` from the repository root.

The root `.env` holds local app configuration; shell and CI variables take precedence. Set `MISTY_PUBLIC_API_URL` to the backend you use. Only public configuration is exposed to the frontend; never put private keys in `VITE_` variables. The server repository is only required when running or changing a local backend.

## Find the code

> For the comprehensive engineering handbook, layer boundaries, and code placement rules, see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

| Directory | Responsibility |
| --- | --- |
| `src/` | Host frontend, account/session handling, workspace, agents, SDK transport and shared UI |
| `src-tauri/` | Native shell, device capabilities and mobile projects |
| `apps/<id>/` | First-party app source and component entry points |
| `apps/interface/` | Shared app catalog and presentation contracts |
| `apps/native-services/` | Native services packaged with apps |
| `packages/contracts/` | Public method schemas and validation |
| `packages/sdk/` | Public typed clients, lifecycle contract and SDK tests |
| `cli/src/` | Rust development and release commands |
| `cli/tasks/` | Internal TypeScript tooling and build fixtures that use Node/Vite APIs |
| `examples/` | Independent SDK consumer examples |
| `release/` | Release policy, trust and validation evidence |
| `docs/` | Architecture and implementation documentation |

## Everyday commands

```sh
misty desktop dev                     # Native desktop development
misty mobile doctor                   # Check Apple mobile prerequisites
misty mobile dev --open               # Mobile development in Xcode
misty apps build planner              # Build one app for desktop/mobile
misty apps build planner --desktop-only
misty apps package planner            # Development-sign the built package
misty sdk build                       # Rebuild SDK/contracts and refresh the host
misty sdk check                       # SDK tests and isolated package installation
misty check tasks                     # Build-tool tests
misty check cli                       # Rust format, lint and tests
misty check app                       # Frontend and native checks
```

Use `npm run dev:web`, `npm run build:desktop`, or `npm run build:mobile` for frontend-only development/builds. Tests live beside their code; run a focused test with `npm test -- path/to/example.test.tsx`.

## Apps and the SDK

App source is ordinary source code in this repository. Each app builds into a versioned component and assets. Production installs download and verify signed packages, check host compatibility and capabilities, then load the component through the SDK. Sharing a repository does not grant an app additional permissions.

Desktop development builds requested apps on demand under `apps/.build/official-apps/`. SDK changes use local npm workspace links, without copied tarballs. Run `misty sdk build` after editing SDK source. Release packaging still creates self-contained SDK archives and validates installation outside this workspace. See the [SDK guide](packages/sdk/README.md) and [example app](examples/habit-tracker/README.md).

Rust owns command orchestration. Tooling that requires Node/Vite APIs lives under `cli/tasks/` as TypeScript; no project-owned `.mjs` scripts are used. Advanced build tasks are available through `misty tasks` and `misty task <name> [arguments]`. Third-party dependencies may contain their own module formats.

## Related repositories

- [misty-server](https://github.com/misty-org/misty-server): API, workers and agent runtime.
- [misty-website](https://github.com/misty-org/misty-website): website and docs, with independent Vite builds and deployments.

For their CLI commands, clone these next to `misty/`. `misty server up`, `misty website dev`, `misty docs dev`, and `misty docs build` use those optional siblings. The CLI discovers the current checkout from its directory; `--workspace` explicitly selects another checkout or organization directory.

## Readiness and releases

The [production-readiness ledger](docs/implementation/agents-production-readiness-ledger.md) tracks implementation, validation and publication work. Passing a build is not evidence that native installs, provider credentials, live integrations or production deployments have been validated.

Host, apps and SDK now record one product source revision. SDK packages and downloadable apps retain independent versions. Release tasks prepare immutable signed artifacts; deployment still requires the appropriate CI secrets, publishing configuration and release evidence.
