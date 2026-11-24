// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use super::{McpConfigSection, McpSourceError, McpSourceInfo};
use std::path::PathBuf;

mod read;
mod write;

use read::read_json_source;
pub(super) use read::{probe_target_from_json, probe_target_from_toml};
pub(super) use write::write_enabled;

#[cfg(test)]
mod tests;

pub(super) const SOURCE_CLAUDE_USER: &str = "claude_user";
pub(super) const SOURCE_CLAUDE_LOCAL: &str = "claude_local";
pub(super) const SOURCE_CLAUDE_PROJECT: &str = "claude_project";
pub(super) const SOURCE_CODEX_USER: &str = "codex_user";
pub(super) const SOURCE_CODEX_PROJECT: &str = "codex_project";

pub(super) const REASON_UNVERIFIED_WRITE: &str = "unverified_write";
pub(super) const REASON_JSONC_READONLY: &str = "jsonc_readonly";
pub(super) const REASON_NEEDS_WORKSPACE: &str = "needs_workspace";

pub(super) struct SourceSpec {
    pub id: &'static str,
    pub engine: &'static str,
    pub scope: &'static str,
    pub writable: bool,
    pub readonly_reason: Option<&'static str>,
    pub readonly_reason_code: Option<&'static str>,
}

#[derive(Clone, Copy)]
pub(super) struct Fields {
    pub(super) command: &'static str,
    pub(super) args: &'static str,
    pub(super) env: &'static str,
    pub(super) cwd: &'static str,
    pub(super) url: &'static str,
    pub(super) url_alt: &'static str,
    pub(super) headers: &'static str,
    pub(super) transport: &'static str,
    pub(super) transport_alt: &'static str,
}

pub(super) const CLAUDE_FIELDS: Fields = Fields {
    command: "command",
    args: "args",
    env: "env",
    cwd: "cwd",
    url: "url",
    url_alt: "",
    headers: "headers",
    transport: "type",
    transport_alt: "",
};
pub(super) const AGY_FIELDS: Fields = Fields {
    url: "serverUrl",
    url_alt: "url",
    ..CLAUDE_FIELDS
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Toggle {
    Disabled,
}

struct Source {
    id: &'static str,
    engine: &'static str,
    scope: &'static str,
    servers_key: &'static str,
    fields: Fields,
    toggle: Option<Toggle>,
    writable: bool,
    readonly_reason_code: &'static str,
}

const SOURCES: &[Source] = &[
    Source {
        id: "agy_user",
        engine: "agy",
        scope: "user",
        servers_key: "mcpServers",
        fields: AGY_FIELDS,
        toggle: Some(Toggle::Disabled),
        writable: false,
        readonly_reason_code: REASON_UNVERIFIED_WRITE,
    },
    Source {
        id: "agy_project",
        engine: "agy",
        scope: "project",
        servers_key: "mcpServers",
        fields: AGY_FIELDS,
        toggle: Some(Toggle::Disabled),
        writable: false,
        readonly_reason_code: REASON_UNVERIFIED_WRITE,
    },
];

pub(super) fn source_spec(id: &str) -> Option<SourceSpec> {
    match id {
        SOURCE_CLAUDE_USER => Some(SourceSpec {
            id: SOURCE_CLAUDE_USER,
            engine: "claude",
            scope: "user",
            writable: true,
            readonly_reason: None,
            readonly_reason_code: None,
        }),
        SOURCE_CLAUDE_LOCAL => Some(SourceSpec {
            id: SOURCE_CLAUDE_LOCAL,
            engine: "claude",
            scope: "project",
            writable: true,
            readonly_reason: None,
            readonly_reason_code: None,
        }),
        SOURCE_CLAUDE_PROJECT => Some(SourceSpec {
            id: SOURCE_CLAUDE_PROJECT,
            engine: "claude",
            scope: "project",
            writable: true,
            readonly_reason: None,
            readonly_reason_code: None,
        }),
        SOURCE_CODEX_USER => Some(SourceSpec {
            id: SOURCE_CODEX_USER,
            engine: "codex",
            scope: "user",
            writable: true,
            readonly_reason: None,
            readonly_reason_code: None,
        }),
        SOURCE_CODEX_PROJECT => Some(SourceSpec {
            id: SOURCE_CODEX_PROJECT,
            engine: "codex",
            scope: "project",
            writable: true,
            readonly_reason: None,
            readonly_reason_code: None,
        }),
        _ => SOURCES
            .iter()
            .find(|source| source.id == id)
            .map(|source| SourceSpec {
                id: source.id,
                engine: source.engine,
                scope: source.scope,
                writable: source.writable,
                readonly_reason: None,
                readonly_reason_code: if source.readonly_reason_code.is_empty() {
                    None
                } else {
                    Some(source.readonly_reason_code)
                },
            }),
    }
}

pub(super) fn engine_of_source(id: &str) -> Option<&'static str> {
    source_spec(id).map(|spec| spec.engine)
}

pub(super) fn probe_target(
    source_id: &str,
    name: &str,
    workspace: Option<&str>,
) -> Result<super::probe::ProbeTarget, super::McpError> {
    let source = SOURCES
        .iter()
        .find(|source| source.id == source_id)
        .ok_or_else(|| super::McpError::invalid("unknown MCP source"))?;
    read::probe_target_for_source(source, name, workspace)
}

pub(super) fn engine_source_infos(engine: &str, workspace: Option<&str>) -> Vec<McpSourceInfo> {
    SOURCES
        .iter()
        .filter(|source| source.engine == engine)
        .filter_map(|source| {
            let candidates = candidate_paths(source.id, workspace);
            let path =
                first_existing(candidates.clone()).or_else(|| candidates.into_iter().next())?;
            Some(McpSourceInfo {
                source: source.id.to_string(),
                exists: file_access::fs::is_file(&path),
                path: path.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

pub(super) fn engine_support(_id: &str) -> &'static str {
    "native"
}

fn antigravity_home() -> PathBuf {
    crate::engine_config::support::engine_home(Some("ANTIGRAVITY_HOME"), ".gemini/antigravity-cli")
}

fn candidate_paths(id: &str, workspace: Option<&str>) -> Vec<PathBuf> {
    let workspace_path = workspace.map(PathBuf::from);
    match id {
        "agy_user" => {
            let mut paths = vec![crate::engine_config::support::engine_home(None, ".gemini")
                .join("config")
                .join("mcp_config.json")];
            paths.push(antigravity_home().join("config").join("mcp_config.json"));
            paths
        }
        "agy_project" => workspace_path
            .map(|path| vec![path.join(".agents").join("mcp_config.json")])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn first_existing(paths: Vec<PathBuf>) -> Option<PathBuf> {
    paths
        .into_iter()
        .find(|path| file_access::fs::is_file(path))
}

pub(super) fn append_entries(section: &mut McpConfigSection, workspace: Option<&str>) {
    for source in SOURCES {
        let Some(path) = first_existing(candidate_paths(source.id, workspace)) else {
            continue;
        };
        match read_json_source(source, &path) {
            Ok(mut entries) => section.entries.append(&mut entries),
            Err(error) => section.errors.push(McpSourceError {
                source: source.id.to_string(),
                path: path.to_string_lossy().into_owned(),
                message: error.message,
            }),
        }
    }
}
