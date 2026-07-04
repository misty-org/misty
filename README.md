# Misty

Misty syncs browser tabs, layouts, and supported website sessions across computers with encrypted workspace storage and sync.

[Get started](#get-started) · [Features](docs/features.md) · [Roadmap](docs/ROADMAP.md) · [Development](docs/development.md) · [Report a bug](https://github.com/misty-org/misty/issues)

> **Set up the backend first:** follow the [Misty Server setup guide](server/README.md#get-started). Once the API health check passes, return here to configure and run the desktop app. If you already have access to a running backend, use its API URL.

## Get started

### 1. Prerequisites

**Required to build the desktop app**

| Tool | Requirement |
| --- | --- |
| Git | Available in your terminal (`git --version`). |
| Node.js | **24.12.0 or newer** (`node --version`). |
| npm | **11 or newer** (`npm --version`). |
| Rust | Install through `rustup`. The app pins **1.91.0** in [rust-toolchain.toml](rust-toolchain.toml); commands run inside `cli/` use its **1.88.0** override. Cargo, rustfmt, and Clippy are required. |
| Backend access | A running Misty backend and its API URL, or the bundled `server/` to run your own. |

**Native build requirements — choose your platform**

| Platform | Requirements |
| --- | --- |
| macOS | Xcode Command Line Tools and an Apple Development certificate with its private key in Keychain. Use Xcode to create the certificate; see [Misty's signing setup](cli/README.md#install-and-start-misty). Full Xcode is also required for iOS/iPadOS development. |
| Windows | Microsoft C++ Build Tools with **Desktop development with C++**, a Windows SDK, the **MSVC** Rust toolchain, and Microsoft Edge **WebView2 Runtime**. |
| Linux | C/C++ build tools, WebKitGTK **4.1** development libraries, OpenSSL, libxdo, AppIndicator, and librsvg development packages. Package names vary by distribution. |

See [Tauri's platform instructions](https://v2.tauri.app/start/prerequisites/) for native dependency installation.

**Required only when running the backend yourself**

- **Docker Engine and Compose v2**, with the daemon running and Linux-container support. Check `docker info` and `docker compose version`.
- The backend is included under **`server/`** in this checkout.
- **For the Cloudflare-backed development stack:** a Cloudflare account ID, API token for the configured Worker deployment, named Tunnel token and API hostname, and Worker name/hostname. Follow the [server environment guide](server/deploy/README.md) for configuration. The server stack supplies `cloudflared`; Worker tooling uses its project-local Wrangler dependency.

### 2. Installation
| Component | Setup |
| --- | --- |
| Node.js and npm | [Install Node.js](https://nodejs.org/en/download) and ensure npm is version 11 or newer. |
| Rust and Cargo | [Install Rust](https://rustup.rs/). |
| Docker and Compose | [Install Docker](https://docs.docker.com/get-started/get-docker/). |
| Cloudflare | Follow the [server environment guide](server/deploy/README.md) for Tunnel and Worker setup. |

Install Misty's CLI and project dependencies, including React, TypeScript, and the Tauri frontend packages:

```sh
git clone https://github.com/misty-org/misty.git
cd misty
cargo install --path cli --locked
misty setup desktop
```

### 3. Environment setup

`misty setup desktop` creates `.env` in the repository root if absent. It uses the backend's local port. For a backend using the default development port:

```dotenv
MISTY_PUBLIC_API_URL=http://127.0.0.1:8081/v1
```

Use your backend's HTTPS URL when connecting through Cloudflare. Keep server secrets in the server environment, not in frontend variables.

### 4. Server setup

Follow the [misty-server setup guide](server/README.md#get-started) to configure and start the backend. The CLI manages the bundled `server/` directory.

Once the backend is running, launch the desktop app:

```sh
misty desktop dev
```

## Key features

- **Browser workspace:** website groups, pinned sites, tabs, split panes, and restored layouts. [Details](docs/features.md#browser-workspace)
- **Device sync:** tabs, layouts, and supported website sessions across computers. Currently in preview. [Details](docs/features.md#device-sync-preview)
- **Encrypted data:** device-side encryption for workspace sync and encrypted local workspace recovery. [Details](docs/features.md#encryption-and-privacy)
- **Agent support:** scoped access to inspect and interact with your browser tabs. [Details](docs/features.md#agent-support)

Private browsing and further privacy controls are tracked in the [privacy milestone](docs/roadmap/browser/permissions.md).

## Platforms

The current desktop sync work targets **macOS and Windows**. Platform-specific implementation and testing are tracked in the [browser ledger](docs/implementation/browser-ledger.md). Linux and Apple mobile development instructions are in the [development guide](docs/development.md); they do not imply the same sync coverage or release readiness.

## Development

Misty uses React, TypeScript, Tauri, and Rust. Built-in tools compile and ship with the app.

- [Development setup and commands](docs/development.md)
- [Architecture and code layout](docs/ARCHITECTURE.md)
- [CLI reference](cli/README.md)
- [Built-in tools](docs/builtin-tools.md)

## Roadmap and contributing

The [roadmap](docs/ROADMAP.md) records what is planned, in development, implemented, tested, and available. Current work focuses on browser permissions, privacy, everyday page tools, downloads, history, and compatibility.

To contribute, choose a roadmap item, check its owner and dependencies, and reference its ID in your issue or pull request. See the [ledger guide](docs/roadmap/README.md) for acceptance and evidence requirements.

For bugs, include your Misty build, operating system, reproduction steps, and expected behavior in an [issue](https://github.com/misty-org/misty/issues). Remove account secrets and private content from logs and screenshots.

## Related repositories

- [server](server/README.md): backend API and agent runtime.
- [misty-website](https://github.com/misty-org/misty-website): website and documentation site.

## Repository layout

Tooling configuration lives in [`.config/`](.config/README.md). Product guidance lives in [`docs/PRODUCT.md`](docs/PRODUCT.md), [`docs/DESIGN.md`](docs/DESIGN.md), and [`docs/ROADMAP.md`](docs/ROADMAP.md). Use the npm scripts to run tools with their configured paths.
