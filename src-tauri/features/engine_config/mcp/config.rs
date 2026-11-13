// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

//! Reading, redacting and safely writing the MCP config sources.
//!
//! Sources and scopes follow the two CLIs' own files:
//! - Claude `~/.claude.json` top-level `mcpServers` (user) and
//!   `projects.<workspace>.mcpServers` (local), toggled through that project's
//!   `disabledMcpServers`;
//! - Claude's workspace `.mcp.json` (project), toggled through the
//!   `enabledMcpjsonServers` / `disabledMcpjsonServers` lists in `.claude/settings.local.json`;
//! - Codex `$CODEX_HOME/config.toml` and the workspace `.codex/config.toml`
//!   `[mcp_servers.<name>] enabled`, changed in place.
//!
//! Writes never rebuild a whole file: TOML goes through toml_edit (comments and unrelated fields
//! stay), JSON through serde_json, then `support::atomic_write` replaces the file. Every write
//! compares the content hash first and refuses to overwrite a change made elsewhere.

use super::probe::ProbeTarget;
use super::sources::{
    probe_target_from_json, probe_target_from_toml, source_spec, SourceSpec, CLAUDE_FIELDS,
    REASON_NEEDS_WORKSPACE, SOURCE_CLAUDE_LOCAL, SOURCE_CLAUDE_PROJECT, SOURCE_CLAUDE_USER,
    SOURCE_CODEX_PROJECT, SOURCE_CODEX_USER,
};
use super::{parse_json, McpConfigEntry, McpConfigSection, McpError, McpSourceError, WRITE_LOCK};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use toml_edit::{value as toml_value, DocumentMut};

pub(super) fn file_hash(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, McpError> {
    file_access::fs::read(path).map_err(|error| McpError::from_io(error, path))
}

pub(super) fn read_text(path: &Path) -> Result<String, McpError> {
    let bytes = read_bytes(path)?;
    String::from_utf8(bytes)
        .map_err(|error| McpError::format(format!("{}: invalid UTF-8: {error}", path.display())))
}

/// The user's Claude config: `~/.claude.json` by default; when `CLAUDE_CONFIG_DIR` is set and
/// holds a `.claude.json`, that one wins (both are places the CLI really reads, so it falls back
/// by which exists).
pub(super) fn claude_user_config_path() -> PathBuf {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|value| !value.is_empty()) {
        let candidate = PathBuf::from(dir).join(".claude.json");
        if file_access::fs::is_file(&candidate) {
            return candidate;
        }
    }
    crate::engine_config::support::home_dir().join(".claude.json")
}

pub(super) fn codex_user_config_path() -> PathBuf {
    crate::engine_config::support::codex_home().join("config.toml")
}

fn claude_project_config_path(workspace: &Path) -> PathBuf {
    workspace.join(".mcp.json")
}
fn claude_project_settings_path(workspace: &Path) -> PathBuf {
    workspace.join(".claude").join("settings.local.json")
}
fn codex_project_config_path(workspace: &Path) -> PathBuf {
    workspace.join(".codex").join("config.toml")
}

// ===== Reading and parsing =====

/// Claude's and Codex's source files (including preferred paths not created yet).
pub(super) fn engine_source_infos(
    engine: &str,
    workspace: Option<&str>,
) -> Vec<super::McpSourceInfo> {
    let info = |source: &str, path: PathBuf| super::McpSourceInfo {
        source: source.to_string(),
        exists: file_access::fs::is_file(&path),
        path: path.to_string_lossy().into_owned(),
    };
    match engine {
        "claude" => {
            let user_path = claude_user_config_path();
            let mut sources = vec![
                info(SOURCE_CLAUDE_USER, user_path.clone()),
                info(SOURCE_CLAUDE_LOCAL, user_path),
            ];
            if let Some(workspace) = workspace {
                sources.push(info(
                    SOURCE_CLAUDE_PROJECT,
                    claude_project_config_path(Path::new(workspace)),
                ));
            }
            sources
        }
        "codex" => {
            let mut sources = vec![info(SOURCE_CODEX_USER, codex_user_config_path())];
            if let Some(workspace) = workspace {
                sources.push(info(
                    SOURCE_CODEX_PROJECT,
                    codex_project_config_path(Path::new(workspace)),
                ));
            }
            sources
        }
        _ => Vec::new(),
    }
}

/// For a probe: reads the config again for the raw entry (not redacted, used only here).
pub(super) fn probe_target(
    source: &str,
    name: &str,
    workspace: Option<&str>,
) -> Result<ProbeTarget, McpError> {
    let missing = || McpError::not_found(format!("The config has no MCP server named “{name}”"));
    match source {
        SOURCE_CLAUDE_USER | SOURCE_CLAUDE_LOCAL => {
            let path = claude_user_config_path();
            let raw = read_text(&path)?;
            let root = parse_json(&raw, &path.to_string_lossy())?;
            let servers = if source == SOURCE_CLAUDE_USER {
                root.get("mcpServers")
            } else {
                let workspace = require_workspace(workspace)?;
                root.get("projects")
                    .and_then(Value::as_object)
                    .and_then(|projects| project_entry(projects, workspace))
                    .and_then(|entry| entry.get("mcpServers"))
            };
            let object = servers
                .and_then(Value::as_object)
                .and_then(|servers| servers.get(name))
                .and_then(Value::as_object)
                .ok_or_else(missing)?;
            Ok(probe_target_from_json(object, false, CLAUDE_FIELDS))
        }
        SOURCE_CLAUDE_PROJECT => {
            let workspace = require_workspace(workspace)?;
            let path = claude_project_config_path(Path::new(workspace));
            let raw = read_text(&path)?;
            let root = parse_json(&raw, &path.to_string_lossy())?;
            let object = root
                .get("mcpServers")
                .and_then(Value::as_object)
                .and_then(|servers| servers.get(name))
                .and_then(Value::as_object)
                .ok_or_else(missing)?;
            Ok(probe_target_from_json(object, false, CLAUDE_FIELDS))
        }
        SOURCE_CODEX_USER | SOURCE_CODEX_PROJECT => {
            let path = if source == SOURCE_CODEX_USER {
                codex_user_config_path()
            } else {
                let workspace = require_workspace(workspace)?;
                codex_project_config_path(Path::new(workspace))
            };
            let raw = read_text(&path)?;
            let document = raw.parse::<DocumentMut>().map_err(|error| {
                McpError::format(format!("{}: invalid TOML: {error}", path.display()))
            })?;
            let table = document
                .get("mcp_servers")
                .and_then(|item| item.as_table_like())
                .and_then(|servers| servers.get(name))
                .and_then(|item| item.as_table_like())
                .ok_or_else(missing)?;
            Ok(probe_target_from_toml(table, CLAUDE_FIELDS))
        }
        _ => super::sources::probe_target(source, name, workspace),
    }
}

pub(super) fn read_config_entries(workspace: Option<&str>) -> McpConfigSection {
    let mut section = McpConfigSection {
        entries: Vec::new(),
        errors: Vec::new(),
    };

    let claude_user_path = claude_user_config_path();
    if file_access::fs::is_file(&claude_user_path) {
        match read_claude_json(&claude_user_path, SOURCE_CLAUDE_USER, workspace) {
            Ok(mut entries) => section.entries.append(&mut entries),
            Err(error) => section.errors.push(McpSourceError {
                source: SOURCE_CLAUDE_USER.to_string(),
                path: claude_user_path.to_string_lossy().into_owned(),
                message: error.message,
            }),
        }
    }

    if let Some(workspace) = workspace {
        let workspace_path = PathBuf::from(workspace);
        let project_path = claude_project_config_path(&workspace_path);
        if file_access::fs::is_file(&project_path) {
            match read_claude_project(&workspace_path) {
                Ok(mut entries) => section.entries.append(&mut entries),
                Err(error) => section.errors.push(McpSourceError {
                    source: SOURCE_CLAUDE_PROJECT.to_string(),
                    path: project_path.to_string_lossy().into_owned(),
                    message: error.message,
                }),
            }
        }
    }

    let codex_user_path = codex_user_config_path();
    if file_access::fs::is_file(&codex_user_path) {
        match read_codex_toml(&codex_user_path, SOURCE_CODEX_USER) {
            Ok(mut entries) => section.entries.append(&mut entries),
            Err(error) => section.errors.push(McpSourceError {
                source: SOURCE_CODEX_USER.to_string(),
                path: codex_user_path.to_string_lossy().into_owned(),
                message: error.message,
            }),
        }
    }

    if let Some(workspace) = workspace {
        let project_path = codex_project_config_path(Path::new(workspace));
        if file_access::fs::is_file(&project_path) {
            match read_codex_toml(&project_path, SOURCE_CODEX_PROJECT) {
                Ok(mut entries) => section.entries.append(&mut entries),
                Err(error) => section.errors.push(McpSourceError {
                    source: SOURCE_CODEX_PROJECT.to_string(),
                    path: project_path.to_string_lossy().into_owned(),
                    message: error.message,
                }),
            }
        }
    }

    section
}

/// `~/.claude.json`: top-level user servers plus the current workspace's local servers. Whether
/// one is off comes from `projects[<workspace>].disabledMcpServers` (Claude Code's TUI writes
/// that key for "disable for this project"; checked against `claude mcp list`, which shows it as
/// Disabled).
fn read_claude_json(
    path: &Path,
    source: &str,
    workspace: Option<&str>,
) -> Result<Vec<McpConfigEntry>, McpError> {
    let raw = read_text(path)?;
    let version = file_hash(raw.as_bytes());
    let root = parse_json(&raw, &path.to_string_lossy())?;
    let project = workspace.and_then(|workspace| {
        root.get("projects")
            .and_then(Value::as_object)
            .and_then(|projects| project_entry(projects, workspace))
    });
    let project_disabled =
        disabled_names(project.and_then(|entry| entry.get("disabledMcpServers")));
    let mut entries = parse_claude_servers(
        root.get("mcpServers"),
        path,
        source,
        &version,
        &[],
        &project_disabled,
        workspace.is_some(),
    )?;
    // Local scope: projects[<workspace>].mcpServers, which belong to this workspace only.
    if let Some(entry) = project {
        let mut local = parse_claude_servers(
            entry.get("mcpServers"),
            path,
            SOURCE_CLAUDE_LOCAL,
            &version,
            &[],
            &project_disabled,
            true,
        )?;
        entries.append(&mut local);
    }
    Ok(entries)
}

/// The project key may be a resolved path (Claude Code keys by realpath): look it up as given,
/// then canonicalized, so a path through a link still finds its local config.
fn project_entry<'a>(projects: &'a Map<String, Value>, workspace: &str) -> Option<&'a Value> {
    workspace_key(projects, workspace).and_then(|key| projects.get(&key))
}

fn disabled_names(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// The workspace `.mcp.json`: project servers, on or off by the approval lists in
/// `.claude/settings.local.json` and the project's disabled list in `.claude.json`.
fn read_claude_project(workspace: &Path) -> Result<Vec<McpConfigEntry>, McpError> {
    let path = claude_project_config_path(workspace);
    let raw = read_text(&path)?;
    let version = file_hash(raw.as_bytes());
    let root = parse_json(&raw, &path.to_string_lossy())?;
    let settings_path = claude_project_settings_path(workspace);
    let settings = read_approval_lists(&settings_path)?;
    let disabled = read_project_disabled(&claude_user_config_path(), workspace);
    parse_claude_servers(
        root.get("mcpServers"),
        &path,
        SOURCE_CLAUDE_PROJECT,
        &version,
        &settings,
        &disabled,
        true,
    )
}

/// That workspace's `disabledMcpServers` in `.claude.json` (empty when it can't be read).
fn read_project_disabled(claude_json_path: &Path, workspace: &Path) -> Vec<String> {
    let Some(workspace) = workspace.to_str() else {
        return Vec::new();
    };
    let Ok(raw) = read_text(claude_json_path) else {
        return Vec::new();
    };
    let Ok(root) = parse_json(&raw, &claude_json_path.to_string_lossy()) else {
        return Vec::new();
    };
    root.get("projects")
        .and_then(Value::as_object)
        .and_then(|projects| project_entry(projects, workspace))
        .map(|entry| disabled_names(entry.get("disabledMcpServers")))
        .unwrap_or_default()
}

#[allow(clippy::too_many_arguments)]
fn parse_claude_servers(
    servers: Option<&Value>,
    path: &Path,
    source: &str,
    version: &str,
    approval: &[Value],
    project_disabled: &[String],
    has_workspace: bool,
) -> Result<Vec<McpConfigEntry>, McpError> {
    let spec = source_spec(source).ok_or_else(|| McpError::internal("unknown MCP source"))?;
    let mut entries = Vec::new();
    let Some(Value::Object(servers)) = servers else {
        // Missing or not an object: nothing to show, and not a broken file (other keys still work).
        return Ok(entries);
    };
    let disabled_list = approval.get(1);
    let listed = |list: Option<&Value>, name: &str| {
        list.and_then(Value::as_array)
            .map(|items| items.iter().any(|item| item.as_str() == Some(name)))
            .unwrap_or(false)
    };
    for (name, raw_spec) in servers {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let Some(spec_object) = raw_spec.as_object() else {
            continue;
        };
        // The disabled list wins; a server on neither list keeps Claude Code's default for project
        // servers (on), which neither `enableAllProjectMcpServers` nor the enabled list changes.
        // The project key's `disabledMcpServers` applies to every scope (the TUI's "disable for
        // this project").
        let enabled = if project_disabled.iter().any(|item| item == name) {
            false
        } else if source == SOURCE_CLAUDE_PROJECT {
            !listed(disabled_list, name)
        } else {
            true
        };
        let mut entry = build_entry(&spec, name, path, version, enabled, spec_object);
        // User and local toggles are kept per project: without a workspace there's nowhere to write.
        if matches!(source, SOURCE_CLAUDE_USER | SOURCE_CLAUDE_LOCAL) && !has_workspace {
            entry.writable = false;
            entry.readonly_reason_code = Some(REASON_NEEDS_WORKSPACE.to_string());
        }
        entries.push(entry);
    }
    Ok(entries)
}

fn build_entry(
    spec: &SourceSpec,
    name: &str,
    path: &Path,
    version: &str,
    enabled: bool,
    spec_object: &Map<String, Value>,
) -> McpConfigEntry {
    let transport = spec_object
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let command = spec_object
        .get("command")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let url = spec_object
        .get("url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(redact_url);
    let args_count = spec_object
        .get("args")
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);
    let env_keys = object_keys(spec_object.get("env"));
    let header_keys = object_keys(spec_object.get("headers"));
    McpConfigEntry {
        id: format!("{}:{}", spec.id, name),
        engine: spec.engine.to_string(),
        name: name.to_string(),
        source: spec.id.to_string(),
        scope: spec.scope.to_string(),
        workspace_file: super::source_in_workspace(spec.id),
        path: path.to_string_lossy().into_owned(),
        format: "json".to_string(),
        enabled,
        transport,
        command,
        args_count,
        url,
        env_keys,
        header_keys,
        writable: spec.writable,
        readonly_reason: spec.readonly_reason.map(str::to_string),
        readonly_reason_code: spec.readonly_reason_code.map(str::to_string),
        version: version.to_string(),
    }
}

pub(super) fn object_keys(value: Option<&Value>) -> Vec<String> {
    let mut keys: Vec<String> = value
        .and_then(Value::as_object)
        .map(|object| object.keys().cloned().collect())
        .unwrap_or_default();
    keys.sort();
    keys
}

fn read_codex_toml(path: &Path, source: &str) -> Result<Vec<McpConfigEntry>, McpError> {
    let spec = source_spec(source).ok_or_else(|| McpError::internal("unknown MCP source"))?;
    let raw = read_text(path)?;
    let version = file_hash(raw.as_bytes());
    let document = raw
        .parse::<DocumentMut>()
        .map_err(|error| McpError::format(format!("{}: invalid TOML: {error}", path.display())))?;
    let mut entries = Vec::new();
    let Some(servers) = document
        .get("mcp_servers")
        .and_then(|item| item.as_table_like())
    else {
        return Ok(entries);
    };
    for (name, item) in servers.iter() {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let Some(table) = item.as_table_like() else {
            continue;
        };
        let enabled = table
            .get("enabled")
            .and_then(|item| item.as_bool())
            .unwrap_or(true);
        let transport = table
            .get("type")
            .and_then(|item| item.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let command = table
            .get("command")
            .and_then(|item| item.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let url = table
            .get("url")
            .and_then(|item| item.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(redact_url);
        let args_count = table
            .get("args")
            .and_then(|item| item.as_array())
            .map(|items| items.len())
            .unwrap_or(0);
        let env_keys: Vec<String> = table
            .get("env")
            .and_then(|item| item.as_table_like())
            .map(|table| table.iter().map(|(key, _)| key.to_string()).collect())
            .unwrap_or_default();
        let mut entry = McpConfigEntry {
            id: format!("{}:{}", spec.id, name),
            engine: spec.engine.to_string(),
            name: name.to_string(),
            source: spec.id.to_string(),
            scope: spec.scope.to_string(),
            workspace_file: super::source_in_workspace(spec.id),
            path: path.to_string_lossy().into_owned(),
            format: "toml".to_string(),
            enabled,
            transport,
            command,
            args_count,
            url,
            env_keys,
            header_keys: Vec::new(),
            writable: spec.writable,
            readonly_reason: spec.readonly_reason.map(str::to_string),
            readonly_reason_code: spec.readonly_reason_code.map(str::to_string),
            version: version.clone(),
        };
        entry.env_keys.sort();
        entries.push(entry);
    }
    Ok(entries)
}

// ===== Redaction =====

/// Whether a key name is a credential (case-insensitive: words such as `key`, `token`, `secret`,
/// alone or with a `_`/`-` prefix or suffix).
pub(super) fn is_sensitive_key(key: &str) -> bool {
    const SENSITIVE: [&str; 16] = [
        "key",
        "apikey",
        "api_key",
        "api-key",
        "token",
        "access_token",
        "auth",
        "authorization",
        "password",
        "passwd",
        "secret",
        "client_secret",
        "credential",
        "credentials",
        "signature",
        "sig",
    ];
    let lowered = key.to_lowercase();
    if SENSITIVE.contains(&lowered.as_str()) {
        return true;
    }
    SENSITIVE.iter().any(|needle| {
        lowered
            .strip_suffix(needle)
            .map(|prefix| prefix.ends_with('_') || prefix.ends_with('-') || prefix.ends_with('.'))
            .unwrap_or(false)
    })
}

/// URLs are redacted by default: userinfo removed, sensitive query values replaced with `***`.
/// When it can't be parsed, the whole query is dropped and only origin and path are kept.
pub(super) fn redact_url(raw: &str) -> String {
    match reqwest::Url::parse(raw) {
        Ok(url) => {
            let mut url = url;
            let user = if url.username().is_empty() {
                None
            } else {
                Some("***")
            };
            let password = url.password().map(|_| "***".to_string());
            let _ = url.set_username(user.unwrap_or(""));
            if let Some(password) = password {
                let _ = url.set_password(Some(&password));
            }
            let pairs: Vec<(String, String)> = url
                .query_pairs()
                .map(|(key, value)| {
                    if is_sensitive_key(&key) {
                        (key.into_owned(), "***".to_string())
                    } else {
                        (key.into_owned(), value.into_owned())
                    }
                })
                .collect();
            if !pairs.is_empty() {
                let mut serializer = url.query_pairs_mut();
                serializer.clear();
                for (key, value) in pairs {
                    serializer.append_pair(&key, &value);
                }
                drop(serializer);
            }
            url.to_string()
        }
        Err(_) => match raw.split_once('?') {
            Some((head, _)) => format!("{head}?***"),
            None => raw.to_string(),
        },
    }
}

// ===== Writing =====

pub(super) fn write_enabled(
    entry_id: &str,
    enabled: bool,
    expected_version: &str,
    workspace: Option<&str>,
) -> Result<McpConfigEntry, McpError> {
    let (source, name) = entry_id
        .split_once(':')
        .ok_or_else(|| McpError::invalid("invalid MCP entry id"))?;
    let spec = source_spec(source).ok_or_else(|| McpError::invalid("unknown MCP source"))?;
    if !spec.writable {
        return Err(McpError::new(
            "readonly",
            spec.readonly_reason
                .or(spec.readonly_reason_code)
                .unwrap_or("this MCP source is read-only"),
        ));
    }
    let name = name.trim();
    if name.is_empty() {
        return Err(McpError::invalid("MCP server name must not be empty"));
    }

    // The other engines' sources take WRITE_LOCK themselves in sources::write_enabled; the lock
    // isn't reentrant, so taking it here first would hang the grok, opencode and omp toggles.
    if !matches!(
        source,
        SOURCE_CODEX_USER
            | SOURCE_CODEX_PROJECT
            | SOURCE_CLAUDE_PROJECT
            | SOURCE_CLAUDE_USER
            | SOURCE_CLAUDE_LOCAL
    ) {
        return super::sources::write_enabled(source, name, enabled, expected_version, workspace);
    }
    let _guard = WRITE_LOCK.lock();
    match source {
        SOURCE_CODEX_USER => {
            set_codex_enabled_in(&codex_user_config_path(), name, enabled, expected_version)?;
            reread_entry(&codex_user_config_path(), source, name, None)
        }
        SOURCE_CODEX_PROJECT => {
            let workspace = require_workspace(workspace)?;
            let path = codex_project_config_path(Path::new(workspace));
            set_codex_enabled_in(&path, name, enabled, expected_version)?;
            reread_entry(&path, source, name, Some(Path::new(workspace)))
        }
        SOURCE_CLAUDE_PROJECT => {
            let workspace = require_workspace(workspace)?;
            let workspace_path = Path::new(workspace);
            let config_path = claude_project_config_path(workspace_path);
            let settings_path = claude_project_settings_path(workspace_path);
            set_claude_project_enabled(
                &config_path,
                &settings_path,
                name,
                enabled,
                expected_version,
            )?;
            reread_entry(&config_path, source, name, Some(workspace_path))
        }
        SOURCE_CLAUDE_USER | SOURCE_CLAUDE_LOCAL => {
            let workspace = require_workspace(workspace)?;
            let path = claude_user_config_path();
            set_claude_disabled_in(&path, workspace, name, enabled, expected_version)?;
            reread_entry(&path, source, name, Some(Path::new(workspace)))
        }
        _ => unreachable!("new-engine sources returned above"),
    }
}

fn require_workspace(workspace: Option<&str>) -> Result<&str, McpError> {
    workspace
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| McpError::invalid("a workspace is required for project-scoped MCP config"))
}

fn reread_entry(
    config_path: &Path,
    source: &str,
    name: &str,
    workspace: Option<&Path>,
) -> Result<McpConfigEntry, McpError> {
    let entries = if config_path
        .extension()
        .map(|ext| ext.eq_ignore_ascii_case("toml"))
        .unwrap_or(false)
    {
        read_codex_toml(config_path, source)?
    } else if matches!(source, SOURCE_CLAUDE_USER | SOURCE_CLAUDE_LOCAL) {
        // `.claude.json`: the project's disabled list is written; read back user and local scopes.
        read_claude_json(
            config_path,
            source,
            workspace.and_then(|path| path.to_str()),
        )?
    } else {
        let raw = read_text(config_path)?;
        let version = file_hash(raw.as_bytes());
        let root = parse_json(&raw, &config_path.to_string_lossy())?;
        if root
            .get("mcpServers")
            .and_then(Value::as_object)
            .map(|servers| servers.contains_key(name))
            .unwrap_or(false)
        {
            let settings_path = config_path
                .parent()
                .map(|workspace| workspace.join(".claude").join("settings.local.json"));
            let settings = settings_path
                .as_deref()
                .map(read_approval_lists)
                .transpose()?
                .unwrap_or_default();
            parse_claude_servers(
                root.get("mcpServers"),
                config_path,
                source,
                &version,
                &settings,
                &[],
                true,
            )?
        } else {
            Vec::new()
        }
    };
    entries
        .into_iter()
        .find(|entry| entry.name == name)
        .ok_or_else(|| McpError::not_found(format!("MCP server \"{name}\" not found after write")))
}

/// Reads the three approval fields in Claude's project settings: `[enabled, disabled, enableAll]`.
fn read_approval_lists(path: &Path) -> Result<Vec<Value>, McpError> {
    if !file_access::fs::is_file(path) {
        return Ok(vec![Value::Null, Value::Null, Value::Bool(false)]);
    }
    let raw = read_text(path)?;
    let root = parse_json(&raw, &path.to_string_lossy())?;
    Ok(vec![
        root.get("enabledMcpjsonServers")
            .cloned()
            .unwrap_or(Value::Null),
        root.get("disabledMcpjsonServers")
            .cloned()
            .unwrap_or(Value::Null),
        root.get("enableAllProjectMcpServers")
            .cloned()
            .unwrap_or(Value::Bool(false)),
    ])
}

/// Codex: `[mcp_servers.<name>] enabled = <bool>`. A missing table or server is not_found; a
/// server or table is never created.
fn set_codex_enabled_in(
    path: &Path,
    name: &str,
    enabled: bool,
    expected_version: &str,
) -> Result<(), McpError> {
    let raw = read_text(path)?;
    let current = file_hash(raw.as_bytes());
    if !expected_version.is_empty() && current != expected_version {
        return Err(McpError::conflict(
            "The config file changed elsewhere. Refresh and try again.",
        ));
    }
    let mut document = raw
        .parse::<DocumentMut>()
        .map_err(|error| McpError::format(format!("{}: invalid TOML: {error}", path.display())))?;
    let Some(servers) = document
        .get_mut("mcp_servers")
        .and_then(|item| item.as_table_like_mut())
    else {
        return Err(McpError::not_found(
            "The config file has no mcp_servers table",
        ));
    };
    let Some(server) = servers
        .get_mut(name)
        .and_then(|item| item.as_table_like_mut())
    else {
        return Err(McpError::not_found(format!(
            "The config has no MCP server named “{name}”"
        )));
    };
    server.insert("enabled", toml_value(enabled));
    crate::engine_config::support::atomic_write(path, &document.to_string())
        .map_err(McpError::internal)
}

/// Claude's user and local toggles: the project's `disabledMcpServers` list in `~/.claude.json`
/// (the same switch as Claude Code's TUI "disable for this project"; checked against
/// `claude mcp list`). The server definition itself is left alone, and a project record that
/// doesn't exist isn't created (the CLI may never have been started in that folder).
fn set_claude_disabled_in(
    path: &Path,
    workspace: &str,
    name: &str,
    enabled: bool,
    expected_version: &str,
) -> Result<(), McpError> {
    let raw = read_text(path)?;
    let current = file_hash(raw.as_bytes());
    if !expected_version.is_empty() && current != expected_version {
        return Err(McpError::conflict(
            "The config file changed elsewhere. Refresh and try again.",
        ));
    }
    let mut root = parse_json(&raw, &path.to_string_lossy())?;
    let exists = root
        .get("mcpServers")
        .and_then(Value::as_object)
        .map(|servers| servers.contains_key(name))
        .unwrap_or(false)
        || root
            .get("projects")
            .and_then(Value::as_object)
            .and_then(|projects| project_entry(projects, workspace))
            .and_then(|entry| entry.get("mcpServers"))
            .and_then(Value::as_object)
            .map(|servers| servers.contains_key(name))
            .unwrap_or(false);
    if !exists {
        return Err(McpError::not_found(format!(
            "The config has no MCP server named “{name}”"
        )));
    }
    let projects = root
        .get_mut("projects")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            McpError::not_found("The config has no record of this project; nothing was changed")
        })?;
    let key = workspace_key(projects, workspace).ok_or_else(|| {
        McpError::not_found("The config has no record of this project; nothing was changed")
    })?;
    let project = projects
        .get_mut(&key)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            McpError::format("The projects entry isn't an object; nothing was changed")
        })?;
    let mut disabled = match project.get("disabledMcpServers") {
        None => Vec::new(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        Some(_) => {
            return Err(McpError::format(
                "disabledMcpServers isn't a list; nothing was changed",
            ))
        }
    };
    disabled.retain(|item| item != name);
    if !enabled {
        disabled.push(name.to_string());
    }
    if disabled.is_empty() {
        project.remove("disabledMcpServers");
    } else {
        project.insert(
            "disabledMcpServers".to_string(),
            Value::Array(disabled.into_iter().map(Value::String).collect()),
        );
    }
    let mut text = serde_json::to_string_pretty(&root)
        .map_err(|error| McpError::internal(error.to_string()))?;
    text.push('\n');
    crate::engine_config::support::atomic_write(path, &text).map_err(McpError::internal)
}

/// Finds the key in `projects` for `workspace` (the key as written in the file, so a write back
/// keeps its name). The two sides spell paths differently: Claude Code stores `S:/a/b` on
/// Windows, while a workspace that went through `ensure_allowed` is `\\?\S:\a\b`. Both drop a
/// `\\?\` prefix, use `/`, lose a trailing separator and ignore case on Windows before comparing;
/// if that still fails, canonicalize is the fallback (links).
fn workspace_key(projects: &Map<String, Value>, workspace: &str) -> Option<String> {
    if projects.contains_key(workspace) {
        return Some(workspace.to_string());
    }
    let find = |target: &str| {
        let wanted = comparable_path(target);
        projects
            .keys()
            .find(|key| comparable_path(key) == wanted)
            .cloned()
    };
    find(workspace).or_else(|| {
        let canonical = file_access::fs::canonicalize(workspace).ok()?;
        find(&canonical.to_string_lossy())
    })
}

/// A path's form for comparing only: never stored or written back.
fn comparable_path(path: &str) -> String {
    let path = path
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .unwrap_or_else(|| path.strip_prefix(r"\\?\").unwrap_or(path).to_string());
    let unified = path.replace('\\', "/");
    let trimmed = unified.trim_end_matches('/');
    let trimmed = if trimmed.is_empty() {
        unified.as_str()
    } else {
        trimmed
    };
    if cfg!(windows) {
        trimmed.to_lowercase()
    } else {
        trimmed.to_string()
    }
}

/// Claude project scope: the server definition stays in `.mcp.json`, and the toggle is written to
/// the enabled/disabled lists in `.claude/settings.local.json` (the person's own file, not the
/// team's shared `settings.json`).
fn set_claude_project_enabled(
    config_path: &Path,
    settings_path: &Path,
    name: &str,
    enabled: bool,
    expected_version: &str,
) -> Result<(), McpError> {
    let raw = read_text(config_path)?;
    let current = file_hash(raw.as_bytes());
    if !expected_version.is_empty() && current != expected_version {
        return Err(McpError::conflict(
            "The config file changed elsewhere. Refresh and try again.",
        ));
    }
    let root = parse_json(&raw, &config_path.to_string_lossy())?;
    let exists = root
        .get("mcpServers")
        .and_then(Value::as_object)
        .map(|servers| servers.contains_key(name))
        .unwrap_or(false);
    if !exists {
        return Err(McpError::not_found(format!(
            "The config has no MCP server named “{name}”"
        )));
    }

    let mut settings: Value = if file_access::fs::is_file(settings_path) {
        let settings_raw = read_text(settings_path)?;
        parse_json(&settings_raw, &settings_path.to_string_lossy())?
    } else {
        Value::Object(Map::new())
    };
    let object = settings
        .as_object_mut()
        .ok_or_else(|| McpError::format("settings.local.json isn't an object at the top"))?;

    let list = |key: &str| -> Result<Vec<String>, McpError> {
        match object.get(key) {
            None => Ok(Vec::new()),
            Some(Value::Array(items)) => Ok(items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()),
            Some(_) => Err(McpError::format(format!(
                "{key} isn't a list; nothing was changed"
            ))),
        }
    };
    let mut enabled_list = list("enabledMcpjsonServers")?;
    let mut disabled_list = list("disabledMcpjsonServers")?;
    enabled_list.retain(|item| item != name);
    disabled_list.retain(|item| item != name);
    if enabled {
        enabled_list.push(name.to_string());
    } else {
        disabled_list.push(name.to_string());
    }
    let write_list = |object: &mut Map<String, Value>, key: &str, items: Vec<String>| {
        if items.is_empty() {
            object.remove(key);
        } else {
            object.insert(
                key.to_string(),
                Value::Array(items.into_iter().map(Value::String).collect()),
            );
        }
    };
    write_list(object, "enabledMcpjsonServers", enabled_list);
    write_list(object, "disabledMcpjsonServers", disabled_list);

    if let Some(parent) = settings_path.parent() {
        file_access::fs::create_dir_all(parent)
            .map_err(|error| McpError::from_io(error, parent))?;
    }
    let mut text = serde_json::to_string_pretty(&settings)
        .map_err(|error| McpError::internal(error.to_string()))?;
    text.push('\n');
    crate::engine_config::support::atomic_write(settings_path, &text).map_err(McpError::internal)
}

#[cfg(test)]
#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("misty-mcp-test-{}-{tag}", std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn redacts_sensitive_url_parts() {
        assert_eq!(
            redact_url("https://user:pass@example.com/mcp?api_key=abc&x=1"),
            "https://***:***@example.com/mcp?api_key=***&x=1"
        );
        assert_eq!(
            redact_url("https://example.com/mcp?token=abc"),
            "https://example.com/mcp?token=***"
        );
        // No query: unchanged.
        assert_eq!(
            redact_url("https://example.com/mcp"),
            "https://example.com/mcp"
        );
        // Not a URL: drop the query to be safe.
        assert_eq!(redact_url("not a url?token=abc"), "not a url?***");
    }

    #[test]
    fn sensitive_key_detection() {
        for key in [
            "API_KEY",
            "apiKey",
            "access_token",
            "MY_SECRET",
            "auth-token",
            "password",
            "Authorization",
        ] {
            assert!(is_sensitive_key(key), "{key} should be sensitive");
        }
        for key in ["path", "url", "command", "user", "secretary"] {
            assert!(!is_sensitive_key(key), "{key} should not be sensitive");
        }
    }

    #[test]
    fn codex_toml_roundtrip_preserves_comments_and_unrelated_fields() {
        let dir = TempDir::new("codex-toggle");
        let path = dir.path().join("config.toml");
        std::fs::write(
            &path,
            "# keep me\ntop_level = 1\n\n[mcp_servers.alpha]\ncommand = \"npx\"\nargs = [\"-y\", \"pkg\"]\nenv = { API_KEY = \"secret\", PLAIN = \"x\" }\n\n[other]\nvalue = true\n",
        )
        .unwrap();
        let version = file_hash(&std::fs::read(&path).unwrap());

        let before = read_codex_toml(&path, SOURCE_CODEX_USER).unwrap();
        assert_eq!(before.len(), 1);
        assert!(before[0].enabled);
        assert_eq!(before[0].env_keys, vec!["API_KEY", "PLAIN"]);
        assert_eq!(before[0].args_count, 2);

        set_codex_enabled_in(&path, "alpha", false, &version).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("# keep me"), "comment preserved: {raw}");
        assert!(raw.contains("top_level = 1"));
        assert!(raw.contains("[other]"));
        let disabled = read_codex_toml(&path, SOURCE_CODEX_USER).unwrap();
        assert!(!disabled[0].enabled);

        let version = file_hash(raw.as_bytes());
        set_codex_enabled_in(&path, "alpha", true, &version).unwrap();
        let enabled = read_codex_toml(&path, SOURCE_CODEX_USER).unwrap();
        assert!(enabled[0].enabled);
    }

    #[test]
    fn codex_version_conflict_blocks_write() {
        let dir = TempDir::new("codex-conflict");
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "[mcp_servers.alpha]\ncommand = \"npx\"\n").unwrap();
        let error = set_codex_enabled_in(&path, "alpha", false, "stale-hash").unwrap_err();
        assert_eq!(error.code, "conflict");
        // The file wasn't rewritten.
        assert!(std::fs::read_to_string(&path).unwrap().contains("command"));
    }

    #[test]
    fn codex_missing_server_and_table_are_not_found_without_writing() {
        let dir = TempDir::new("codex-missing");
        let path = dir.path().join("config.toml");
        let original = "[mcp_servers.alpha]\ncommand = \"npx\"\n";
        std::fs::write(&path, original).unwrap();
        let version = file_hash(original.as_bytes());
        let error = set_codex_enabled_in(&path, "ghost", false, &version).unwrap_err();
        assert_eq!(error.code, "not_found");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);

        std::fs::write(&path, "top = 1\n").unwrap();
        let version = file_hash(b"top = 1\n");
        let error = set_codex_enabled_in(&path, "alpha", false, &version).unwrap_err();
        assert_eq!(error.code, "not_found");
    }

    #[test]
    fn codex_invalid_toml_is_format_error_without_writing() {
        let dir = TempDir::new("codex-broken");
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "not = [valid").unwrap();
        let error = read_codex_toml(&path, SOURCE_CODEX_USER).unwrap_err();
        assert_eq!(error.code, "format");
        let version = file_hash(b"not = [valid");
        let error = set_codex_enabled_in(&path, "alpha", false, &version).unwrap_err();
        assert_eq!(error.code, "format");
    }

    /// Escapes a path as a JSON string before putting it in JSON text: Windows paths hold `\`,
    /// which would make invalid JSON (an invalid escape).
    fn json_key(value: &str) -> String {
        serde_json::to_string(value).expect("json string")
    }

    #[test]
    fn claude_project_toggle_writes_personal_settings_only() {
        // read_claude_project reads the process env through claude_user_config_path(); share
        // the lock with the other home-folder tests so it never sees a value mid-change.
        let _guard = crate::engine_config::support::HOME_ENV_LOCK.lock();
        let dir = TempDir::new("claude-project-toggle");
        let mcp = dir.path().join(".mcp.json");
        let settings = dir.path().join(".claude").join("settings.local.json");
        std::fs::write(
            &mcp,
            r#"{"mcpServers":{"alpha":{"command":"npx","env":{"TOKEN":"x"}},"beta":{"url":"https://x/mcp?key=1"}}}"#,
        )
        .unwrap();
        let version = file_hash(&std::fs::read(&mcp).unwrap());

        set_claude_project_enabled(&mcp, &settings, "alpha", false, &version).unwrap();
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert_eq!(
            written["disabledMcpjsonServers"],
            serde_json::json!(["alpha"])
        );

        let entries = read_claude_project(dir.path()).unwrap();
        let alpha = entries.iter().find(|entry| entry.name == "alpha").unwrap();
        assert!(!alpha.enabled);
        assert_eq!(alpha.env_keys, vec!["TOKEN"]);
        assert!(alpha.writable);
        let beta = entries.iter().find(|entry| entry.name == "beta").unwrap();
        assert!(beta.enabled);
        assert_eq!(beta.url.as_deref(), Some("https://x/mcp?key=***"));

        // On again: the disabled list is emptied and the enabled list gets the name.
        let version = file_hash(&std::fs::read(&mcp).unwrap());
        set_claude_project_enabled(&mcp, &settings, "alpha", true, &version).unwrap();
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert!(written.get("disabledMcpjsonServers").is_none());
        assert_eq!(
            written["enabledMcpjsonServers"],
            serde_json::json!(["alpha"])
        );
    }

    #[test]
    fn claude_project_missing_server_or_conflict_refuses() {
        let dir = TempDir::new("claude-refuse");
        let mcp = dir.path().join(".mcp.json");
        let settings = dir.path().join(".claude").join("settings.local.json");
        std::fs::write(&mcp, r#"{"mcpServers":{"alpha":{"command":"npx"}}}"#).unwrap();
        let version = file_hash(&std::fs::read(&mcp).unwrap());
        let error =
            set_claude_project_enabled(&mcp, &settings, "ghost", false, &version).unwrap_err();
        assert_eq!(error.code, "not_found");
        assert!(!settings.exists());

        let error =
            set_claude_project_enabled(&mcp, &settings, "alpha", false, "stale").unwrap_err();
        assert_eq!(error.code, "conflict");
    }

    #[test]
    fn claude_json_scopes_share_the_project_disable_list() {
        let dir = TempDir::new("claude-json");
        let path = dir.path().join(".claude.json");
        let workspace = dir.path().join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        let workspace_key = workspace.to_string_lossy().into_owned();
        let workspace_json = json_key(&workspace_key);
        std::fs::write(
            &path,
            format!(
                r#"{{"mcpServers":{{"user-server":{{"command":"npx"}}}},"projects":{{{workspace_json}:{{"mcpServers":{{"local-server":{{"url":"https://x/mcp"}}}},"disabledMcpServers":["user-server"]}}}}}}"#
            ),
        )
        .unwrap();
        let entries = read_claude_json(&path, SOURCE_CLAUDE_USER, Some(&workspace_key)).unwrap();
        let user = entries
            .iter()
            .find(|entry| entry.source == SOURCE_CLAUDE_USER)
            .unwrap();
        // A user server turned off by the project's disabled list, and now toggled in place.
        assert!(!user.enabled);
        assert!(user.writable);
        let local = entries
            .iter()
            .find(|entry| entry.source == SOURCE_CLAUDE_LOCAL)
            .unwrap();
        assert_eq!(local.name, "local-server");
        assert!(local.writable);
        assert!(local.enabled);

        // No workspace: readable but not writable (the disabled list is kept per project).
        let without = read_claude_json(&path, SOURCE_CLAUDE_USER, None).unwrap();
        assert!(!without[0].writable);
        assert_eq!(
            without[0].readonly_reason_code.as_deref(),
            Some(REASON_NEEDS_WORKSPACE)
        );
    }

    #[test]
    fn claude_user_toggle_writes_the_project_disable_list() {
        // `write_enabled` goes through claude_user_config_path(): pointing CLAUDE_CONFIG_DIR at a
        // scratch folder keeps the real ~/.claude.json untouched and covers dispatch, write and
        // read-back.
        let _guard = crate::engine_config::support::HOME_ENV_LOCK.lock();
        let dir = TempDir::new("claude-toggle");
        let path = dir.path().join(".claude.json");
        let workspace = dir.path().join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        let workspace_key = workspace.to_string_lossy().into_owned();
        let workspace_json = json_key(&workspace_key);
        let original = format!(
            "{{\n  \"mcpServers\": {{\n    \"alpha\": {{ \"command\": \"npx\" }}\n  }},\n  \"projects\": {{\n    {workspace_json}: {{}}\n  }}\n}}\n"
        );
        std::fs::write(&path, &original).unwrap();
        std::env::set_var("CLAUDE_CONFIG_DIR", dir.path());

        // Like Claude Code's TUI "disable for this project": the project key's disabledMcpServers.
        let entry = write_enabled(
            "claude_user:alpha",
            false,
            &file_hash(original.as_bytes()),
            Some(&workspace_key),
        )
        .unwrap();
        assert!(!entry.enabled);
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            written["projects"][&workspace_key]["disabledMcpServers"],
            serde_json::json!(["alpha"])
        );
        // The server definition itself is left alone: no enabled field is added to the entry.
        assert!(written["mcpServers"]["alpha"]["command"] == "npx");
        assert!(written["mcpServers"]["alpha"].get("enabled").is_none());

        // On again: the name leaves the list (an empty list removes the key).
        let entry = write_enabled(
            "claude_user:alpha",
            true,
            &file_hash(&std::fs::read(&path).unwrap()),
            Some(&workspace_key),
        )
        .unwrap();
        assert!(entry.enabled);
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(
            written["projects"][&workspace_key]
                .get("disabledMcpServers")
                .is_none(),
            "empty list is dropped"
        );

        std::env::remove_var("CLAUDE_CONFIG_DIR");
    }

    #[test]
    fn claude_project_keys_match_across_windows_path_spellings() {
        // Claude Code stores `S:/a/b` on Windows; Misty's workspace after ensure_allowed is
        // `\\?\S:\a\b`. Both must reach the same project key, or a toggle always reports "no
        // record of this project". The key comes back as written, so a write keeps its name.
        let projects: Map<String, Value> =
            serde_json::from_str(r#"{ "S:/AIWorker/Proj": {}, "/home/u/ws": {} }"#).unwrap();
        assert_eq!(
            workspace_key(&projects, r"\\?\S:\AIWorker\Proj").as_deref(),
            Some("S:/AIWorker/Proj")
        );
        assert_eq!(
            workspace_key(&projects, r"S:\AIWorker\Proj\").as_deref(),
            Some("S:/AIWorker/Proj")
        );
        assert_eq!(
            workspace_key(&projects, "/home/u/ws/").as_deref(),
            Some("/home/u/ws")
        );
        assert!(workspace_key(&projects, r"S:\AIWorker\Other").is_none());
        assert!(project_entry(&projects, r"\\?\S:\AIWorker\Proj").is_some());
        if cfg!(windows) {
            // Windows paths ignore case.
            assert_eq!(
                workspace_key(&projects, r"\\?\s:\aiworker\proj").as_deref(),
                Some("S:/AIWorker/Proj")
            );
        }
    }

    #[test]
    fn claude_user_toggle_needs_a_workspace_and_a_known_server() {
        let _guard = crate::engine_config::support::HOME_ENV_LOCK.lock();
        let dir = TempDir::new("claude-toggle-guard");
        let path = dir.path().join(".claude.json");
        let workspace = dir.path().join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        let workspace_key = workspace.to_string_lossy().into_owned();
        let workspace_json = json_key(&workspace_key);
        std::fs::write(
            &path,
            r#"{"mcpServers":{"alpha":{"command":"npx"}},"projects":{}}"#,
        )
        .unwrap();
        std::env::set_var("CLAUDE_CONFIG_DIR", dir.path());

        // No workspace: the disabled list is kept per project, so there's nowhere to write.
        let error = write_enabled("claude_user:alpha", false, "", None).unwrap_err();
        assert_eq!(error.code, "invalid_input");
        // No project record: none is created, nothing is written.
        let error =
            write_enabled("claude_user:alpha", false, "", Some(&workspace_key)).unwrap_err();
        assert_eq!(error.code, "not_found");

        std::fs::write(
            &path,
            format!(
                r#"{{"mcpServers":{{"alpha":{{"command":"npx"}}}},"projects":{{{workspace_json}:{{}}}}}}"#
            ),
        )
        .unwrap();
        // No such server: refused.
        let error = write_enabled(
            "claude_user:ghost",
            false,
            &file_hash(&std::fs::read(&path).unwrap()),
            Some(&workspace_key),
        )
        .unwrap_err();
        assert_eq!(error.code, "not_found");
        // Version conflict: a change made elsewhere isn't overwritten; the file stays as it was.
        let error =
            write_enabled("claude_user:alpha", false, "stale", Some(&workspace_key)).unwrap_err();
        assert_eq!(error.code, "conflict");
        assert!(std::fs::read_to_string(&path).unwrap().contains("alpha"));

        std::env::remove_var("CLAUDE_CONFIG_DIR");
    }

    #[test]
    fn write_enabled_rejects_readonly_and_unknown_sources() {
        let error = write_enabled("kimi_user:alpha", true, "", None).unwrap_err();
        assert_eq!(error.code, "readonly");
        let error = write_enabled("bogus:alpha", true, "", None).unwrap_err();
        assert_eq!(error.code, "invalid_input");
        let error = write_enabled("codex_project:alpha", true, "", None).unwrap_err();
        assert_eq!(error.code, "invalid_input");
    }

    #[test]
    fn new_engine_toggle_through_the_command_path_does_not_deadlock() {
        // engine_mcp_set_enabled → config::write_enabled → sources::write_enabled: if the outer
        // call took WRITE_LOCK first, the inner one would deadlock. Run it on a thread with a time
        // limit so a hang fails the test instead of stalling it.
        let _guard = crate::engine_config::support::HOME_ENV_LOCK.lock();
        let dir = TempDir::new("omp-toggle-command-path");
        let path = dir.path().join("mcp.json");
        let original = "{\n  \"mcpServers\": {\n    \"alpha\": { \"command\": \"npx\" }\n  }\n}\n";
        std::fs::write(&path, original).unwrap();
        std::env::set_var("OMP_CODING_AGENT_DIR", dir.path());
        let version = file_hash(original.as_bytes());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(write_enabled("omp_user:alpha", false, &version, None));
        });
        let result = rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("toggle deadlocked on WRITE_LOCK");
        std::env::remove_var("OMP_CODING_AGENT_DIR");
        assert!(!result.unwrap().enabled);
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            written["mcpServers"]["alpha"]["enabled"],
            serde_json::json!(false)
        );
    }
}
