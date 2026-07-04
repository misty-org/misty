# Developing Misty

[Back to the README](../README.md)

## Start developing

Install Node.js **24.12+**, npm **11+**, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system. Linux needs WebKitGTK 4.1; Apple mobile development needs Xcode.

```sh
git clone https://github.com/misty-org/misty.git
cd misty
cargo install --path cli --locked
misty setup desktop
misty desktop dev
```

One clone contains the frontend, native shell, built-in tools, SDK, contracts, server, and CLI. There are no Git submodules or sibling SDK/app checkouts to install. `misty setup desktop` installs the root lockfile and builds the workspace SDK packages. Run `misty --help` to explore commands. Without installing the binary, use `cargo run --manifest-path cli/Cargo.toml -- <command>` from the repository root.

On macOS, desktop development requires an Apple Development signing certificate. See the [CLI guide](../cli/README.md) for signing setup and additional commands. Development builds do not establish release support for every platform.

The root `.env` holds local app configuration; shell and CI variables take precedence. Set `MISTY_PUBLIC_API_URL` to the backend you use. Only public configuration is exposed to the frontend; never put private keys in `VITE_` variables. The server repository is only required when running or changing a local backend.

## Find the code

Misty uses React 19, a Tauri shell, and a Rust native core. Website views use the operating system's browser engine: WKWebView on macOS and WebView2 on Windows. See the [architecture guide](../docs/ARCHITECTURE.md) for module boundaries and code placement.

| Directory | Responsibility |
| --- | --- |
| `src/` | Host frontend, account/session handling, workspace, agents, SDK transport and shared UI |
| `src-tauri/` | Native shell, device capabilities and mobile projects |
| `src/features/<tool>/` | Built-in tool source and component entry points |
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
misty sdk build                       # Rebuild SDK/contracts and refresh the host
misty sdk check                       # SDK tests and isolated package installation
misty check tasks                     # Build-tool tests
misty check cli                       # Rust format, lint and tests
misty check app                       # Frontend and native checks
```

Use `npm run dev:web`, `npm run build:desktop`, or `npm run build:mobile` for frontend-only development/builds. Tests live beside their code; run a focused test with `npm test -- path/to/example.test.tsx`.

## Built-in tools and shared interfaces

Built-in tools compile and ship with Misty. They have no separate app catalog, installation, or update lifecycle. See the [built-in tools guide](builtin-tools.md).

Shared contracts and SDK interfaces live in `packages/contracts` and `packages/sdk`. Changes use local npm workspace links. Run `misty sdk build` after editing SDK source and `misty sdk check` to validate it.

Rust owns command orchestration. Tooling that requires Node/Vite APIs lives under `cli/tasks/` as TypeScript; no project-owned `.mjs` scripts are used. Advanced build tasks are available through `misty tasks` and `misty task <name> [arguments]`. Third-party dependencies may contain their own module formats.

## Related repositories

- [server](../server/README.md): API, workers and agent runtime.
- [misty-website](https://github.com/misty-org/misty-website): website and docs, with independent Vite builds and deployments.

For their CLI commands, clone these next to `misty/`. `misty server up`, `misty website dev`, `misty docs dev`, and `misty docs build` use those optional siblings. The CLI discovers the current checkout from its directory; `--workspace` explicitly selects another checkout or organization directory.

