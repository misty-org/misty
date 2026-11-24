// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use super::read::{read_json_source, read_toml_source, string_array};
use super::{candidate_paths, first_existing, source_spec, Source, SOURCES};
use crate::engine_config::mcp::config::{file_hash, read_text};
use crate::engine_config::mcp::{McpConfigEntry, McpError, WRITE_LOCK};
use std::path::Path;
use toml_edit::{value as toml_value, Array, DocumentMut};

pub(crate) fn write_enabled(
    source_id: &str,
    name: &str,
    enabled: bool,
    expected_version: &str,
    workspace: Option<&str>,
) -> Result<McpConfigEntry, McpError> {
    let spec = source_spec(source_id).ok_or_else(|| McpError::invalid("unknown MCP source"))?;
    if !spec.writable {
        return Err(McpError::new(
            "readonly",
            spec.readonly_reason
                .or(spec.readonly_reason_code)
                .unwrap_or("this MCP source is read-only"),
        ));
    }
    let source = SOURCES
        .iter()
        .find(|source| source.id == source_id)
        .ok_or_else(|| McpError::invalid("unknown MCP source"))?;
    let path = first_existing(candidate_paths(source_id, workspace)).ok_or_else(|| {
        McpError::not_found("The config file doesn't exist; nothing was changed".to_string())
    })?;
    let _guard = WRITE_LOCK.lock();
    match source_id {
        "grok_user" => set_grok_user_enabled(&path, name, enabled, expected_version)?,
        _ => {
            return Err(McpError::new(
                "readonly",
                "this MCP source is read-only in the current build",
            ))
        }
    }
    reread_entry(source, &path, name)
}

fn reread_entry(source: &Source, path: &Path, name: &str) -> Result<McpConfigEntry, McpError> {
    let entries = match source.format {
        "toml" => read_toml_source(source, path)?,
        _ => read_json_source(source, path)?,
    };
    entries
        .into_iter()
        .find(|entry| entry.name == name)
        .ok_or_else(|| {
            McpError::not_found(format!("MCP server “{name}” wasn't found after the write"))
        })
}

pub(super) fn verify_version(raw: &str, expected_version: &str) -> Result<(), McpError> {
    let current = file_hash(raw.as_bytes());
    if !expected_version.is_empty() && current != expected_version {
        return Err(McpError::conflict(
            "The config file changed elsewhere. Refresh and try again.",
        ));
    }
    Ok(())
}

fn set_grok_user_enabled(
    path: &Path,
    name: &str,
    enabled: bool,
    expected_version: &str,
) -> Result<(), McpError> {
    let raw = read_text(path)?;
    verify_version(&raw, expected_version)?;
    let mut document = raw
        .parse::<DocumentMut>()
        .map_err(|error| McpError::format(format!("{}: invalid TOML: {error}", path.display())))?;
    {
        let servers = document
            .get_mut("mcp_servers")
            .and_then(|item| item.as_table_like_mut())
            .ok_or_else(|| McpError::not_found("The config file has no mcp_servers table"))?;
        let server = servers
            .get_mut(name)
            .and_then(|item| item.as_table_like_mut())
            .ok_or_else(|| {
                McpError::not_found(format!("The config has no MCP server named “{name}”"))
            })?;
        server.insert("enabled", toml_value(enabled));
    }
    let mut disabled = string_array(&document, "disabled_mcp_servers")?;
    disabled.retain(|item| item != name);
    if !enabled {
        disabled.push(name.to_string());
    }
    if disabled.is_empty() {
        document.remove("disabled_mcp_servers");
    } else {
        let mut array = Array::new();
        for item in disabled {
            array.push(item);
        }
        document.insert("disabled_mcp_servers", toml_value(array));
    }
    crate::engine_config::support::atomic_write(path, &document.to_string())
        .map_err(McpError::internal)
}
