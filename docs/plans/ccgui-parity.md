# ccgui parity

Written 2026-11-11. Misty matches desktop-cc-gui (MIT) feature for feature or goes beyond it. This is
the whole list, checked against ccgui at `0130e43`. Delete a row when it is done and seen working,
and this file when no rows are left.

Everything below marked done is in the working tree, uncommitted. The Rust crate compiles and the
type check is clean, but none of it has been run in the app yet, so every row still needs a look
in the running app before it is deleted.

Status: **done** (ported), **partial** (ported with a piece missing), **missing**, **out** (decided
against).

## Decided against

| ccgui | Why |
|---|---|
| Plugin system, plugin SDK, marketplace, plugin-creator skill | Engines have their own (Claude Code plugins, Codex plugins and skills), and Misty already lists their commands and skills. ccgui's plugins extend ccgui's own interface; Misty's interface stays closed to third-party panels. |
| Languages (ccgui's Chinese and Korean) | English only. |
| Brand marks for API Route and Requesty | Neither has a public mark; their presets show a letter. |
| LAN web access and the relay tunnel | No remote interface: the desktop app is used on the desktop. |
| Baidu analytics | Not a feature for the person. |
| react-scan toggle | A developer-only tool Misty doesn't ship. |
| Mission workbench | ccgui hides it from everyone. It is a workflow, so a flow of steps belongs in Workflows if people ask for one. |

## Left

| Area | What | Status | Note |
|---|---|---|---|
| App | Linux build (AppImage, deb, rpm) | partial | `tauri.linux.conf.json` and `misty release` build it, and the crate passes `cargo check` for x86_64 Linux. Never built or run on Linux. The confined workers run under Landlock, seccomp and (where allowed) namespaces, and refuse to start without Landlock; voice captures through PulseAudio or pipewire-pulse, and dictation's keys and paste reach X11 and XWayland apps only. `misty release` strips the AppImage's bundled Wayland libraries as ccgui does. Agent pages take real GDK input, read cross-origin frames from a private script world and open sign-in popups. Computer use and desktop control use XTest on X11 and the RemoteDesktop portal on Wayland. Overlays sit above other windows on X11 and on layer-shell compositors, but not on GNOME Wayland. Wayland doesn't let apps see the pointer, the window in front or Escape, so the companion can't follow the pointer there and Escape doesn't stop control. Controls aren't snapped to on Linux. |
| App | Windows | partial | No Windows-only code has been compiled since the port: WSL transport, job objects, clipboard, Explorer reveal, shell icons. |

## Done

### Engines (`src-tauri/features/engines`)

| ccgui | Note |
|---|---|
| Claude Code, Codex, Kimi, Grok, Pi, Oh My Pi, DeepSeek Harness, Antigravity, OpenCode, Qoder (global and CN), MiniMax, CodeBuddy | ccgui's adapters, vendored whole. Gemini and Qwen run on its ACP driver too, beyond ccgui. |
| Streaming, thinking, interrupt, images | Thinking folds when the answer starts. |
| Session history: list, import, search, rename, resume | From each CLI's own files; Misty keeps an index. |
| Message queue, `/new`, `/clear`, `/compact`, fork | `/compact` is text except on Oh My Pi, as in ccgui. |
| Permission modes including Bypass | Mapped natively in `agents/run_control/engine_modes.rs`. |
| Live model lists and reasoning effort | ccgui's `engine/models`. |
| Token usage and context window | |
| Todos, sub-agents | Claude's from ccgui; Codex's written new (ccgui has none). |
| Question cards, plan review | |
| Codex app-server kept alive, read-only mode, Fast service tier | |
| Background follow-ups into a live Claude process | |
| Tool lists enforced per engine | Claude Code, CodeBuddy and Pi; the rest refuse a list without the shell, as in ccgui. |
| An agent's engine arguments and MCP servers | Permission, sandbox, MCP, settings and resume flags refused. |
| WSL transport, Windows job object | Not compiled on Windows. |
| Sign-in for Kimi, Qoder, Grok, MiniMax and Antigravity | Checked against each CLI's docs (none is installed here, and ccgui has no sign-in for them): Kimi and Qoder type `/login` and `/logout`, Grok runs `grok login` and `grok logout`, MiniMax `mcode login` (with `--region global` for a Global account, picked in the row) and `mcode logout`, Antigravity starts `agy` to sign in and types `/logout`. |
| Memory | Removed 2026-11-11 for the beta: engines keep their own memory, and Misty offers no `mem_*` tools. |
| Codex MCP server env and headers kept off the command line | Through Codex's environment with `env_vars`, `env_http_headers` and `bearer_token_env_var`. |

### Chat (`src/features/agents/conversations`)

| ccgui | Note |
|---|---|
| Streaming render: paced reveal, chunked parsing, cached highlighting | |
| Tool rows with raw parameters, diff and terminal viewers, line counts | |
| Run details: time, tokens, model; context breakdown | |
| Run status strip | |
| Anchor rail, search inside a chat | |
| File links in replies with a context menu | |
| Granting a refused folder from the chat | |
| Prompt history, command palette, chat shortcuts | |
| Prompt library on `!`, personas on `#` | |
| `@` file menu from the panel's `.gitignore`-aware index | Cached per folder and refreshed in the background (`composer/controls/mentionFiles.ts`). |
| Git branch switcher in the composer bar | ccgui's `use-branch-switcher`: follows a nested repository selected in the file tree. Chat branches stay separate chats made by fork, as in ccgui. |
| Search opens a folded step that holds the match | |

### Panels (`src/features/agents/context-panel`, `src-tauri/features/project`)

| ccgui | Note |
|---|---|
| File tree: virtualized, Git colors, `.gitignore`, nested repositories, saved expansion, shortcuts, search and full-text search, context menu | |
| Editor: tabs, Markdown and HTML preview, find and replace | HTML preview is inlined in a sandboxed frame instead of ccgui's URL scheme. |
| Terminal: tabs, shells that outlive the panel, WebGL, links | |
| Git: ahead/behind, stage all, discard, image diffs, branches, push, pull, init, tree view | Commit, push and pull use the person's own `git`. |
| Worktrees: list, create from a branch or pull request, remove | |
| Open in VS Code, Cursor, JetBrains, Finder or a chosen app | |
| Launch scripts | |
| Folder names, order and archive; window size and place | |
| "Open in" opens the file shown in the editor | The file manager still shows the folder. |
| Warn before removing a worktree a chat or terminal works in | |
| Folder owner avatars | GitHub owner of `origin`, in the folder menu (`project_git_owners`). |
| Windows clipboard fallback when another app holds it | Retries the open, then compares the change count (`project_clipboard_change_count`). Not compiled on Windows. |

### Settings and the rest

| ccgui | Note |
|---|---|
| The engines' own MCP servers: list, toggle, probe, start on demand | |
| Skills hub | |
| Usage stats and plan limits | Limits read through each CLI, never from the Keychain. |
| Provider channels with presets and brand marks, CC Switch import | Keys in the OS keychain. |
| Proxy | |
| CLI install, update, version and sign-in for every engine | Sign-in runs the vendor's own login. |
| Program paths, Codex home, custom models | |
| Fonts, performance panel | |
| Bots | Bot folders import and export as agents. |
| Agent catalog | agency-agents, MIT. |
| Computer use for engines | Through Misty's MCP server and native gate, not a separate binary. |
| Pets | |
| Quit guard, updater, settings | Already in Misty. |
| Changelog after an update | The release's own notes, kept when it installs and shown once in a dialog after the restart (`src/features/updater/releaseNotes.ts`). |
| Pi custom providers edited one at a time | ccgui's block editor (`piFamilyModelsBlocks.ts`): edit or remove one provider's block, the rest of the file kept as written; the whole-file editor stays. |
| SOCKS proxy for Misty's own requests | reqwest's `socks` feature (no new crates in 0.13); the Settings proxy applies to `support::http_client` for every scheme it accepts. |
| Installing a CLI in a terminal | The vendor installers (Claude Code, Codex) run in the install dialog's own terminal, the sign-in dialog's pseudo-terminal (`engine_cli_install_in_terminal`). |
| Reveal in Finder from the MCP servers list | `engine_mcp_reveal`, only for a path the inventory reads; from the detail dialog and the list of files read. |
| Windows job object for MCP servers started on demand | `mcp/lazy.rs` puts each server in `cli_lifecycle/job.rs`'s kill-on-close job. Not compiled on Windows. |
| Chat activity counts in the performance panel | Engine, tool and text events counted from `watchAllRunEvents` (`performance/activity.ts`). |
