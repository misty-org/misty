# Misty Extensions

Misty now supports two extension models:

- `file_actions`: manifest-driven external tools launched from the file explorer
- `plugin`: in-process plugins that register commands and ImGui panels through a versioned C ABI

This document describes the plugin model because that is the new hostable extension surface.

## Plugin goals

The plugin system is intentionally narrow:

- Misty owns discovery, loading, lifecycle, shortcuts, and panel windows
- plugins contribute commands and panels
- plugins do not link against Misty's internal C++ classes
- plugins talk to Misty only through a versioned C ABI function table

That gives Misty a more stable boundary than exposing raw C++ interfaces or internal headers.

## Security and safety model

Plugins are not a hard security boundary.

- they run in-process
- they can crash Misty with memory corruption or other undefined behavior
- marketplace review improves trust, but it does not sandbox native code

The host does enforce some guardrails:

- manifest `schema_version` and plugin `abi_version` must match Misty's supported values
- the plugin library path must stay inside the plugin directory after canonicalization
- duplicate plugin, command, and panel ids are rejected
- the host API surface is intentionally small
- signed plugins must match the expected SDK version, build id, platform, architecture, and library SHA-256
- signed plugins must verify against a trusted Ed25519 public key before Misty loads them
- if `MISTY_REQUIRE_SIGNED_PLUGINS=ON`, unsigned plugins are rejected before load
- if a command or panel callback throws a C++ exception, Misty marks that plugin as faulted and stops invoking it

If you want true isolation, this model is not enough on its own. It is an in-process plugin system with host validation, not a secure sandbox.

## Discovery roots

Misty looks for plugins in:

- bundled: `build/bin/plugins`
- user-installed: `~/.misty/plugins`

Each plugin must live in its own folder and contain a `manifest.json`.

Example:

```text
plugins/
  preview_manager/
    manifest.json
    preview_manager.dylib
```

## Manifest format

Plugins use `manifest.json` with a `plugin` section:

```json
{
  "schema_version": 1,
  "id": "misty.preview-manager",
  "name": "Preview Manager",
  "version": "0.1.0",
  "author": "Misty",
  "description": "Sample plugin that opens a preview manager panel.",
  "enabled": true,
  "platforms": ["macos", "linux", "windows"],
  "plugin": {
    "abi_version": 1,
    "library": "preview_manager.dylib",
    "sdk_version": "1.0",
    "build_id": "Darwin-arm64-AppleClang-17.0.0.17000013-sdk1.0",
    "platform": "macos",
    "arch": "arm64",
    "sha256": "<sha256>",
    "signature": {
      "algorithm": "ed25519",
      "signer": "misty-dev",
      "value": "<base64-signature>"
    }
  }
}
```

Rules:

- `id` and `name` must be non-empty
- `schema_version` must be `1`
- `plugin.abi_version` must match `MISTY_PLUGIN_ABI_VERSION`
- `plugin.library` must be a relative path inside the plugin directory
- signed plugins should include `sdk_version`, `build_id`, `platform`, `arch`, `sha256`, and `signature`
- absolute library paths are rejected

## ABI contract

The public plugin ABI lives in:

- `src/core/extensions/plugin_api.h`

Required exports:

- `misty_plugin_abi_version()`
- `misty_plugin_register(const MistyPluginRegistrarApi*)`

The registrar lets a plugin contribute:

- commands
- panels

The host API currently exposes:

- `open_panel`
- `close_panel`
- `is_panel_open`
- `copy_current_view_id`
- `notify`

The UI API is intentionally small:

- `text`
- `text_wrapped`
- `button`
- `same_line`
- `separator`
- `spacing`

That is deliberate. Plugins render through host-owned ImGui callbacks, but the ABI surface stays narrow and versionable.

## Runtime model

At startup, Misty loads plugins through:

- loader and registry: `src/core/extensions/plugin_host.h`
- implementation: `src/core/extensions/plugin_host.cpp`

The host:

- discovers plugin folders
- validates manifests
- loads the shared library
- checks the exported ABI version
- verifies signed plugin metadata before `dlopen`
- calls the plugin registration entrypoint
- registers runtime commands with `CommandManager`
- renders open plugin panels each frame in host-owned ImGui windows

Plugins do not own top-level windows themselves. They contribute content to host-managed windows.

## Commands and panels

A plugin normally works like this:

1. Register a command such as `preview-manager.open`
2. Optionally provide a default shortcut such as `Primary+]`
3. Register a panel such as `preview-manager.panel`
4. In the command callback, call `host->open_panel(...)`
5. Misty opens or focuses that panel and calls the plugin's render callback every frame while it is visible

This is the closest fit to Misty's current ImGui architecture.

## Sample plugin

The bundled sample plugin lives in:

- source: `plugins/preview_manager/plugin.cpp`
- manifest template: `plugins/preview_manager/manifest.json.in`

It demonstrates:

- exported ABI functions
- command registration
- panel registration
- host notifications
- reading the current Misty view id

## Sandbox binary

Misty also builds a lightweight sandbox app:

- source: `src/tools/plugin_sandbox_main.cpp`
- binary: `misty-plugin-sandbox`

Purpose:

- load one plugin directory in isolation from the main app flow
- exercise command registration and panel rendering
- let extension authors test how their panel behaves without launching full Misty

Important limitation:

- this is a development harness, not a security sandbox
- it still loads the plugin in-process
- it helps reproduce crashes and UI issues earlier, but it does not contain malicious native code

You can launch it with:

```sh
./bin/misty-plugin-sandbox --plugin-dir ./bin/plugins/preview_manager
```

To sign a plugin manifest for marketplace/official verification:

```sh
./bin/misty-plugin-sandbox --sign-plugin --plugin-dir ./bin/plugins/preview_manager --private-key ./plugin-private.pem --signer misty-dev
```

To verify the packaged plugin without opening the GUI:

```sh
./bin/misty-plugin-sandbox --verify-plugin --plugin-dir ./bin/plugins/preview_manager
```

For an official Misty build, configure a trusted public key at build time:

```sh
cmake -S app -B build -DMISTY_PLUGIN_TRUST_PUBKEY=/path/to/plugin-public.pem
```

To require signatures for every plugin in that build:

```sh
cmake -S app -B build -DMISTY_PLUGIN_TRUST_PUBKEY=/path/to/plugin-public.pem -DMISTY_REQUIRE_SIGNED_PLUGINS=ON
```

Or open it from Misty's `Extensions` view with the `Sandbox` button.

## Marketplace guidance

If Misty ships a marketplace for plugins, treat review as a policy layer, not a safety boundary.

Recommended split:

- official plugins: first-party, signed, tested against the current Misty build
- marketplace plugins: reviewed, signed, ABI-version-gated
- local plugins: clearly marked as untrusted and unsupported, or rejected entirely when `MISTY_REQUIRE_SIGNED_PLUGINS=ON`

Even with review, plugins should be treated as trusted code with compatibility constraints.

## Current implementation files

- plugin ABI: `src/core/extensions/plugin_api.h`
- plugin host: `src/core/extensions/plugin_host.h`
- plugin host implementation: `src/core/extensions/plugin_host.cpp`
- commands integration: `src/core/commands/command_manager.cpp`
- extensions UI: `src/panels/extensions/extensions_panel.cpp`
- sample plugin: `plugins/preview_manager/plugin.cpp`
- sandbox harness: `src/tools/plugin_sandbox_main.cpp`

## Future directions

If this model grows, the next sensible additions are:

- API version negotiation beyond a single integer
- explicit plugin unload hooks
- plugin capability flags and permission prompts
- optional out-of-process helpers for risky workloads
- plugin signing and integrity metadata
