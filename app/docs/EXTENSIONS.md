# Misty Extensions

This document describes:

- what Misty supports today
- what "embedded extensions" actually means in practice
- what direction Misty should take next
- what kind of extension system is likely to be easiest for third-party developers

## Current state

Misty currently supports one extension capability: `file_actions`.

That means:

- Misty discovers extension folders from disk.
- Each extension has a `manifest.json`.
- A file action can match a selected file by extension or MIME type.
- Matching actions appear in the file explorer context menu under `Extensions`.
- When the user clicks one, Misty launches the extension executable as a detached process.

Current discovery roots:

- Bundled extensions: `build/bin/extensions`
- User-installed extensions: `~/.misty/extensions`

Current implementation files:

- runtime types: `src/application/core/extensions/extension_manager.h`
- discovery/matching/launch: `src/application/core/extensions/extension_manager.cpp`
- file explorer menu integration: `src/application/panels/file_explorer/menus_ui.cpp`

## Important clarification

Extensions are not currently embedded into Misty's UI.

Today, Misty acts as:

- a manifest loader
- a matcher
- a launcher

It does not currently:

- host extension-rendered ImGui UI
- embed foreign OS windows inside a Misty panel
- capture stdout/stderr as a rendering surface
- stream a child process directly into an ImGui dock/tab

So the current model is:

- Misty-owned menu
- extension-owned process
- separate UI, if any

## Why this still matters

This is still a useful first step because the packaging/runtime contract is already good enough for:

- previews via native helper apps
- "open in tool X"
- converters/transcoders
- send/share/export actions
- workflow automations

It also gives Misty a clean install format that can later back a marketplace.

## Package layout

Each extension is just a folder:

```text
my-extension/
  manifest.json
  run.sh
  assets/
```

## Current manifest shape

```json
{
  "schema_version": 1,
  "id": "misty.native-preview",
  "name": "Native Preview",
  "version": "0.1.0",
  "description": "Preview PDFs and images in a native viewer.",
  "platforms": ["linux", "macos"],
  "file_actions": [
    {
      "id": "preview.open",
      "title": "Preview",
      "description": "Launch a preview helper.",
      "executable": "/usr/bin/env",
      "args": ["bash", "{extension_dir}/preview.sh", "{file_path}"],
      "extensions": [".pdf", ".png", ".jpg", ".jpeg"],
      "mime_types": ["application/pdf", "image/*"]
    }
  ]
}
```

## Supported placeholders

- `{file_path}`
- `{file_name}`
- `{file_dir}`
- `{file_ext}`
- `{mime_type}`
- `{extension_id}`
- `{extension_name}`
- `{extension_dir}`
- `{misty_executable_dir}`

## Matching rules

- Extensions are discovered by folder.
- Each extension must contain `manifest.json`.
- User-installed extensions override bundled extensions with the same `id`.
- `file_actions` match non-directory files by extension or MIME type.
- If an extension or action declares `platforms`, it only loads on those platforms.

## What "embedded inside Misty" actually means

There are three different models people often mix together:

### 1. External action extension

This is what Misty has now.

- Misty shows a menu item.
- Misty launches an executable.
- The executable does its work or opens its own window.

This is easy to build and easy to distribute.

### 2. External helper, Misty-owned UI

This is the recommended next step for Misty.

- Misty owns the panel, tab, modal, or window.
- The extension runs as a separate helper process.
- The extension does not draw ImGui directly.
- The extension sends data, assets, or UI content to Misty over IPC.
- Misty renders or hosts the result.

This gives you "extension views inside Misty" without turning Misty into a native plugin ABI problem.

### 3. True in-process UI plugin

This is the hardest model.

- Misty loads a third-party shared library or script runtime.
- The plugin draws directly into Misty's ImGui context.

This has major downsides:

- ABI/versioning problems
- crash isolation is poor
- security/sandboxing is worse
- third-party authoring is harder
- upgrades are more fragile

Misty should avoid starting here.

## DockSpace clarification

Dear ImGui DockSpace helps with layout only.

DockSpace is useful for:

- docked panels
- tabbed panes
- movable extension views
- a persistent "Preview" panel

DockSpace does not by itself allow:

- embedding a foreign executable's window inside a docked ImGui panel
- letting another process draw directly into Misty's ImGui context

So DockSpace is still valuable, but only as the host layout/container system.

## How VS Code does it, conceptually

VS Code is closer to model 2 than model 3.

At a high level:

- VS Code owns the main UI
- extensions run in a separate extension-host process
- richer extension UIs are often shown in webviews
- communication happens through message passing

The key idea is that the host owns the surface and lifecycle, while the extension provides behavior and content.

That is the right mental model for Misty too.

## Recommended direction for Misty

Misty should keep the current `file_actions` model and add a second capability for hostable views.

Recommended capability families:

- `file_actions`
  - context-menu commands
  - shell out and perform work
- `views`
  - docked panels
  - tabs
  - modal views
  - separate Misty-owned windows
- `preview_provider`
  - specialized view contract for file preview

## Why a webview surface is probably the right move

If the goal is making third-party extensions easy to build, a webview-based surface is likely the best fit.

Reasons:

- extension authors already know HTML/CSS/JS
- people can port an existing small web app quickly
- UI iteration is faster than native ImGui code
- it avoids asking third parties to learn Misty's internal C++ UI code
- the boundary between host and extension is easier to formalize

This is especially attractive if you want:

- custom preview panels
- editors
- media viewers
- dashboards
- provider-specific management UI

For third-party authors, "build a small web app and talk to Misty over messages" is dramatically easier than "learn C++, ImGui, build system details, and Misty's internal rendering conventions."

## Recommended host model

Misty should own:

- the dock/tab/window lifecycle
- focus and docking behavior
- selection context
- command dispatch
- permissions
- theme/host messaging

Extensions should own:

- their business logic
- their view content
- their internal state
- any file-format-specific processing

This suggests a model like:

- Misty opens an extension tab/panel/window
- Misty launches or connects to the extension process
- the extension exposes content through a webview endpoint or structured IPC
- Misty passes host context and receives commands/events back

## Two realistic paths for embedded views

### Path A: structured-data IPC

The extension returns data and Misty renders it natively in ImGui.

Examples:

- image preview paths
- PDF page raster outputs
- metadata tables
- text content
- toolbar commands

Benefits:

- fully native look
- simpler host control
- predictable rendering

Costs:

- more work for Misty
- less freedom for extension authors

### Path B: embedded webview

The extension provides HTML/CSS/JS content and Misty hosts it in a webview surface.

Examples:

- preview UI
- custom inspector/editor
- extension marketplace panes
- provider-specific setup or admin interfaces

Benefits:

- easiest for third parties
- closest to VS Code's extension ergonomics
- rich UI without teaching authors ImGui

Costs:

- need a webview dependency and lifecycle model
- host/extension messaging needs to be designed carefully
- theming and security need to be handled deliberately

For Misty, Path B is likely the better default for third-party extension views.

## Recommended architecture

Short version:

1. Keep `file_actions` as the lightweight executable model.
2. Add Misty-owned extension views.
3. Use DockSpace as the layout container.
4. Use a webview as the default embedded extension surface.
5. Keep extensions out-of-process.

That gives Misty:

- modularity
- crash isolation
- easy marketplace packaging
- easier third-party adoption

## Proposed extension capability roadmap

### Phase 1: current

- manifest discovery
- file action matching
- detached process launch

### Phase 2: hostable extension views

Add support for extension-declared views, for example:

```json
{
  "views": [
    {
      "id": "preview.main",
      "title": "Preview",
      "type": "panel"
    }
  ]
}
```

Misty would open:

- docked panel
- tab
- modal
- separate window

But the container is still owned by Misty.

### Phase 3: preview provider contract

Add a specialized preview capability, for example:

```json
{
  "preview_provider": {
    "id": "pdf.preview",
    "extensions": [".pdf"],
    "mime_types": ["application/pdf"],
    "view": "panel"
  }
}
```

Then Misty can ask:

- can you preview this file?
- what kind of surface do you provide?
- what URL/content/data should be shown?

### Phase 4: marketplace

Marketplace delivery can reuse the same package format:

1. host a signed extension index
2. download an extension archive
3. install to `~/.misty/extensions/<id>`
4. reload extensions

## Suggested message model for embedded extensions

If Misty adopts hostable views, a simple message model is likely enough:

Host to extension:

- `activate`
- `open_view`
- `close_view`
- `selection_changed`
- `file_opened`
- `theme_changed`
- `command_invoked`

Extension to host:

- `set_title`
- `render_url`
- `navigate`
- `show_notification`
- `request_file`
- `execute_command`
- `close_view`

This can be implemented over:

- stdio
- local sockets
- named pipes

Stdio is likely the simplest place to start.

## Webview recommendation

For third-party authoring, a webview surface is probably key.

Recommendation:

- use web technologies for embedded extension views
- keep Misty as the host shell
- keep extensions as separate processes
- let extensions serve or emit their UI
- use a message bridge between Misty and the extension view

This gives extension authors a much lower barrier to entry:

- they can reuse existing frontend code
- they can ship HTML/JS/CSS instead of native UI code
- they can think in terms of "small app inside Misty"

That is likely the best way to make Misty extensions approachable.

## Practical recommendation

Misty should not try to make external executables render directly into ImGui.

Instead:

- keep executable actions for lightweight integrations
- add a real Misty-owned extension panel/tab/window system
- host embedded extension UIs through a webview surface
- treat DockSpace as the layout manager for those hosted views

That gives you the right separation:

- Misty owns the shell
- extensions own their content
- communication happens through a stable protocol

## Notes on the bundled preview sample

There is currently a bundled `native-preview` sample extension in `app/extensions/native-preview/`.

That sample exists only to demonstrate the current action-extension model end to end. It is not intended to define the final preview architecture.

The likely long-term direction is:

- remove the sample from the default bundle
- keep the framework
- implement a proper embedded preview/view extension system afterward
