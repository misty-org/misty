// The engines' own MCP servers (Settings › Tools › MCP servers): what each CLI's config files
// declare, and what a live session reported.
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//
// Design constraints:
// - "Enabled in config" and "connected at runtime" are two separate sections, each with its own
//   source, collection time and failure reason.
// - Entry ids are generated here; the write commands never take a file path from the window.
//   Project sources must sit inside a folder linked to a Space (`support::ensure_allowed`).
// - Enabling and disabling is offered only for sources whose write semantics were verified on the
//   real CLI: Codex user/project `config.toml` `enabled`, the enabled/disabled lists for Claude's
//   project `.mcp.json`, and Claude's per-project `disabledMcpServers`. Everything else is shown
//   read-only with the reason.
// - Writes to one path are serialized, checked against a version (a content hash) for conflicts,
//   and replaced atomically. A file that fails to parse is never written or reset.
// - Lists and details redact URL query credentials, auth headers and environment values.
// - Misty's own server (`misty`, injected by `engines/mcp.rs`) is never listed as editable and
//   never written.

use serde::{Deserialize, Serialize};
use serde_json::Value;

mod config;
pub mod probe;
pub mod runtime;
mod sources;

use config::*;
use sources::{engine_of_source, engine_support};

/// The name Misty's own MCP server goes by in every engine's config (`engines/mcp.rs`).
pub const MISTY_SERVER_NAME: &str = "misty";

/// Sources whose config file sits inside the workspace folder (`.mcp.json`, `.codex/config.toml`,
/// `.omp/mcp.json` and each engine's project/local files), so its content can arrive with a
/// repository. Their commands and addresses aren't trusted: opening the page never probes them, a
/// manual probe first asks the person to confirm the full command, and the probe doesn't expand
/// `${ENV}` into URLs or headers (or a repository could use one probe to send a key from the
/// environment anywhere). `claude_local` is project-scoped but lives in the person's own
/// `~/.claude.json`, not in the repository. Unknown sources are treated as workspace sources.
pub(crate) fn source_in_workspace(source: &str) -> bool {
    if source == sources::SOURCE_CLAUDE_LOCAL {
        return false;
    }
    sources::source_spec(source).is_none_or(|spec| spec.scope == "project")
}

/// Resolves an entry id to the real command or address (not redacted; only the probe uses it).
pub(crate) fn probe_target(
    entry_id: &str,
    workspace: Option<&str>,
) -> Result<probe::ProbeTarget, McpError> {
    let (source, name) = entry_id
        .split_once(':')
        .ok_or_else(|| McpError::invalid("invalid MCP entry id"))?;
    let name = name.trim();
    if name.is_empty() {
        return Err(McpError::invalid("MCP server name must not be empty"));
    }
    let mut target = config::probe_target(source, name, workspace)?;
    target.from_workspace = source_in_workspace(source);
    Ok(target)
}

/// Serializes writes to the same path: read back before writing plus an atomic replace, with this
/// lock, keeps Misty's own concurrent writes from overwriting each other. Claude/Codex (config)
/// and the other engines (sources) share it.
pub(super) static WRITE_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpError {
    code: &'static str,
    message: String,
}

impl McpError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_input", message)
    }
    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message)
    }
    pub(crate) fn format(message: impl Into<String>) -> Self {
        Self::new("format", message)
    }
    pub(crate) fn conflict(message: impl Into<String>) -> Self {
        Self::new("conflict", message)
    }
    pub(crate) fn from_io(error: std::io::Error, path: &std::path::Path) -> Self {
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => "not_found",
            std::io::ErrorKind::PermissionDenied => "permission",
            _ => "internal",
        };
        Self::new(code, format!("{}: {error}", path.display()))
    }
}

/// One server entry in a config source (URL, env and headers redacted).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigEntry {
    /// Generated here as `"{source}:{name}"`; the window only sends it back, never parses it.
    pub(crate) id: String,
    pub(crate) engine: String,
    pub(crate) name: String,
    /// claude_user | claude_project | codex_user | codex_project | …
    pub(crate) source: String,
    /// user | project
    pub(crate) scope: String,
    /// The config file is in the workspace folder (`source_in_workspace`): its content came with
    /// the repository, so it isn't probed automatically and is confirmed before a probe. The
    /// window goes by this, not by `scope`.
    pub(crate) workspace_file: bool,
    /// The file's path, for display.
    pub(crate) path: String,
    pub(crate) format: String,
    pub(crate) enabled: bool,
    pub(crate) transport: Option<String>,
    pub(crate) command: Option<String>,
    pub(crate) args_count: usize,
    pub(crate) url: Option<String>,
    pub(crate) env_keys: Vec<String>,
    pub(crate) header_keys: Vec<String>,
    pub(crate) writable: bool,
    pub(crate) readonly_reason: Option<String>,
    /// Why it's read-only, as a code the window turns into words; None for older sources.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) readonly_reason_code: Option<String>,
    /// The file's content hash when read; a write reads it again and refuses on a mismatch.
    pub(crate) version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSourceError {
    pub(crate) source: String,
    pub(crate) path: String,
    pub(crate) message: String,
}

/// A source file that was read. Listed even when it doesn't exist yet, so an empty state can say
/// where the page looked.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSourceInfo {
    pub(crate) source: String,
    pub(crate) path: String,
    pub(crate) exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigSection {
    pub(crate) entries: Vec<McpConfigEntry>,
    pub(crate) errors: Vec<McpSourceError>,
}

/// A runtime entry: from a real session (Claude's init event), with when and from which session.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRuntimeEntry {
    pub(crate) name: String,
    pub(crate) status: Option<String>,
    pub(crate) builtin: bool,
    pub(crate) tool_names: Vec<String>,
    pub(crate) resources_count: usize,
    pub(crate) templates_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRuntimeSection {
    /// ready | no_session | session_ended | unsupported | unavailable
    pub(crate) status: String,
    pub(crate) reason: Option<String>,
    pub(crate) workspace: Option<String>,
    pub(crate) session_id: Option<String>,
    pub(crate) collected_at: Option<i64>,
    pub(crate) entries: Vec<McpRuntimeEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpEngineInventory {
    pub(crate) id: String,
    pub(crate) available: bool,
    /// native (built in) / plugin (provided by a plugin) / none (no MCP).
    pub(crate) support: String,
    /// The source files this engine reads (listed even when not created yet).
    pub(crate) sources: Vec<McpSourceInfo>,
    pub(crate) config: McpConfigSection,
    pub(crate) runtime: McpRuntimeSection,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInventory {
    pub(crate) engines: Vec<McpEngineInventory>,
    pub(crate) collected_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSetEnabledRequest {
    pub(crate) entry_id: String,
    pub(crate) enabled: bool,
    pub(crate) version: String,
    #[serde(default)]
    pub(crate) workspace: Option<String>,
}

fn person_window(webview: &tauri::Webview) -> Result<(), McpError> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err(McpError::new(
            "permission",
            "Only a profile's window can do this.",
        ))
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, McpError> + Send + 'static,
) -> Result<T, McpError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| McpError::internal(format!("MCP worker failed: {error}")))?
}

/// Every engine gets its own section. Engines whose runtime can be queried get a snapshot; the
/// rest say plainly that this build can't query them, rather than pretending they have no servers.
#[tauri::command]
pub async fn engine_mcp_inventory(
    webview: tauri::Webview,
    workspace: Option<String>,
) -> Result<McpInventory, McpError> {
    person_window(&webview)?;
    blocking(move || {
        let workspace = validate_workspace(workspace.as_deref())?;
        Ok(inventory(workspace.as_deref()))
    })
    .await
}

fn inventory(workspace: Option<&str>) -> McpInventory {
    let mut config = read_config_entries(workspace);
    // The other engines' declared sources (Kimi, Grok, OMP, OpenCode, Antigravity, Qoder, dsh)
    // join the same list, then each engine's tab takes its own.
    sources::append_entries(&mut config, workspace);
    let collected_at = now_ms();

    let by_engine = |engine: &str, available: bool, runtime: McpRuntimeSection| {
        let mut section = McpConfigSection {
            entries: config
                .entries
                .iter()
                .filter(|entry| entry.engine == engine)
                .cloned()
                .collect(),
            errors: config
                .errors
                .iter()
                .filter(|error| engine_of_source(&error.source) == Some(engine))
                .cloned()
                .collect(),
        };
        // A stable order (source, then name), so the list doesn't follow the key order in files.
        section.entries.sort_by(|a, b| {
            a.source
                .cmp(&b.source)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        let mut sources = config::engine_source_infos(engine, workspace);
        sources.extend(sources::engine_source_infos(engine, workspace));
        McpEngineInventory {
            id: engine.to_string(),
            available,
            support: engine_support(engine).to_string(),
            sources,
            config: section,
            runtime,
        }
    };

    let engines = crate::engines::support::config::ENGINES
        .iter()
        .map(|engine| {
            let id = *engine;
            // Only Claude sessions report an MCP snapshot today; the other engines keep an
            // explicit "can't query" state.
            let runtime = if id == "claude" {
                runtime::claude_section(workspace)
            } else {
                McpRuntimeSection {
                    // `unsupported` means "this build can't query it": no CLI or MCP process is
                    // ever started just to list servers.
                    status: "unsupported".to_string(),
                    reason: None,
                    workspace: None,
                    session_id: None,
                    collected_at: None,
                    entries: Vec::new(),
                }
            };
            by_engine(id, crate::engines::installed(id), runtime)
        })
        .collect();

    McpInventory {
        engines,
        collected_at,
    }
}

/// Turns one entry on or off: compare versions, replace atomically, read back what it is now.
#[tauri::command]
pub async fn engine_mcp_set_enabled(
    webview: tauri::Webview,
    request: McpSetEnabledRequest,
) -> Result<McpConfigEntry, McpError> {
    person_window(&webview)?;
    if request.entry_id.ends_with(&format!(":{MISTY_SERVER_NAME}")) {
        return Err(McpError::invalid("Misty's own server is managed by Misty."));
    }
    blocking(move || {
        let workspace = validate_workspace(request.workspace.as_deref())?;
        write_enabled(
            &request.entry_id,
            request.enabled,
            &request.version,
            workspace.as_deref(),
        )
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRevealRequest {
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) workspace: Option<String>,
}

/// Shows one config file this page lists in the file manager (the folder that would hold it, when
/// it doesn't exist yet). The path must be one the inventory reads, so a window can't point the
/// file manager anywhere else.
#[tauri::command]
pub async fn engine_mcp_reveal(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    request: McpRevealRequest,
) -> Result<(), McpError> {
    person_window(&webview)?;
    let target = blocking(move || {
        let workspace = validate_workspace(request.workspace.as_deref())?;
        let workspace = workspace.as_deref();
        let wanted = request.path.trim();
        let mut entries = read_config_entries(workspace);
        sources::append_entries(&mut entries, workspace);
        let listed = crate::engines::support::config::ENGINES
            .iter()
            .any(|engine| {
                config::engine_source_infos(engine, workspace)
                    .into_iter()
                    .chain(sources::engine_source_infos(engine, workspace))
                    .any(|info| info.path == wanted)
            })
            || entries.entries.iter().any(|entry| entry.path == wanted);
        if wanted.is_empty() || !listed {
            return Err(McpError::invalid("That file isn't one this page lists."));
        }
        let path = std::path::PathBuf::from(wanted);
        if file_access::fs::is_file(&path) {
            return Ok((path, true));
        }
        match path
            .parent()
            .filter(|parent| file_access::fs::is_dir(parent))
        {
            Some(parent) => Ok((parent.to_path_buf(), false)),
            None => Err(McpError::not_found(
                "Neither the file nor its folder exists yet.",
            )),
        }
    })
    .await?;
    use tauri_plugin_opener::OpenerExt;
    let opened = match target {
        (path, true) => app.opener().reveal_item_in_dir(path),
        (folder, false) => app
            .opener()
            .open_path(folder.to_string_lossy(), None::<&str>),
    };
    opened.map_err(|_| McpError::internal("The file manager couldn't be opened."))
}

pub(crate) fn now_ms() -> i64 {
    crate::engine_config::support::now_ms()
}

/// Project sources must sit in a folder linked to a Space; any other path is refused before a
/// file on it is read.
fn validate_workspace(workspace: Option<&str>) -> Result<Option<String>, McpError> {
    let Some(raw) = workspace.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let resolved = crate::engine_config::support::ensure_allowed(raw).map_err(McpError::invalid)?;
    Ok(Some(resolved.to_string_lossy().into_owned()))
}

/// Parses JSON text. Key order isn't kept: serde_json's `preserve_order` stays off in Misty, so a
/// rewritten config file comes back with its keys sorted (the same settings, in another order).
pub(crate) fn parse_json(text: &str, path: &str) -> Result<Value, McpError> {
    serde_json::from_str::<Value>(text)
        .map_err(|error| McpError::format(format!("{path}: invalid JSON: {error}")))
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
