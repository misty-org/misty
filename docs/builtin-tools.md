# Built-in Misty tools

`src/features` contains the source for Files, Browser, Journal, Planner, Library, and the other built-in tool components. They compile with Misty and have no separate catalog, installation, permission-consent release, or update lifecycle.

Run `misty desktop dev` for development and `npm run build:desktop` to build the frontend. `misty check tools` runs the tool tests. Dependencies come from the root workspace lockfile.

On macOS, the native build compiles the document-processing, file-search, and peer-transport workers for the same architecture and profile as Misty and embeds them in its executable. These workers retain their process isolation and per-operation folder/account grants. They update with Misty.

The shared SDK types and component interfaces remain in `packages/sdk` and `packages/contracts`; built-in source uses those interfaces without downloading executable packages.

Shared tool helpers live in `src/shared/toolAssets`. Bundled Rust workers live in `src-tauri/services`. All frontend modules use the root TypeScript, Vite, and test configuration.
