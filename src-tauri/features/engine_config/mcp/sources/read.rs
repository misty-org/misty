// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use super::{
    candidate_paths, first_existing, source_spec, Fields, Source, Toggle, REASON_JSONC_READONLY,
};
use crate::engine_config::mcp::config::{file_hash, object_keys, read_text, redact_url};
use crate::engine_config::mcp::probe::ProbeTarget;
use crate::engine_config::mcp::{parse_json, McpConfigEntry, McpError};
use serde_json::{Map, Value};
use std::path::Path;

pub(super) fn parse_jsonc(text: &str, path: &str) -> Result<Value, McpError> {
    let stripped = strip_jsonc(text)
        .ok_or_else(|| McpError::format(format!("{path}: unterminated string in JSONC")))?;
    serde_json::from_str::<Value>(&stripped)
        .map_err(|error| McpError::format(format!("{path}: invalid JSON: {error}")))
}

pub(super) fn strip_jsonc(text: &str) -> Option<String> {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    while let Some(ch) = chars.next() {
        if in_string {
            out.push(ch);
            if ch == '\\' {
                if let Some(next) = chars.next() {
                    out.push(next);
                }
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => {
                in_string = true;
                out.push(ch);
            }
            '/' if chars.peek() == Some(&'/') => {
                for next in chars.by_ref() {
                    if next == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut previous = ' ';
                for next in chars.by_ref() {
                    if previous == '*' && next == '/' {
                        break;
                    }
                    previous = next;
                }
            }
            _ => out.push(ch),
        }
    }
    if in_string {
        return None;
    }
    let mut trimmed = String::with_capacity(out.len());
    let mut pending_comma: Option<usize> = None;
    for ch in out.chars() {
        match ch {
            ',' => {
                pending_comma = Some(trimmed.len());
                trimmed.push(ch);
            }
            ']' | '}' => {
                if let Some(index) = pending_comma.take() {
                    trimmed.remove(index);
                }
                trimmed.push(ch);
            }
            ch if ch.is_whitespace() => trimmed.push(ch),
            ch => {
                pending_comma = None;
                trimmed.push(ch);
            }
        }
    }
    Some(trimmed)
}

pub(super) fn read_json_source(
    source: &Source,
    path: &Path,
) -> Result<Vec<McpConfigEntry>, McpError> {
    let raw = read_text(path)?;
    let version = file_hash(raw.as_bytes());
    let is_jsonc = is_jsonc(path);
    let root = if is_jsonc {
        parse_jsonc(&raw, &path.to_string_lossy())?
    } else {
        parse_json(&raw, &path.to_string_lossy())?
    };
    let mut entries = Vec::new();
    let Some(servers) = root.get(source.servers_key).and_then(Value::as_object) else {
        return Ok(entries);
    };
    for (name, raw_spec) in servers {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let Some(spec_object) = raw_spec.as_object() else {
            continue;
        };
        entries.push(build_entry(
            source,
            name,
            path,
            &version,
            spec_object,
            is_jsonc,
        ));
    }
    Ok(entries)
}

pub(super) fn is_jsonc(path: &Path) -> bool {
    path.extension()
        .map(|ext| ext.to_string_lossy().eq_ignore_ascii_case("jsonc"))
        .unwrap_or(false)
}

pub(super) fn build_entry(
    source: &Source,
    name: &str,
    path: &Path,
    version: &str,
    spec_object: &Map<String, Value>,
    is_jsonc: bool,
) -> McpConfigEntry {
    let spec = source_spec(source.id).expect("registered source");
    let writable = spec.writable && !is_jsonc;
    let readonly_reason_code = if is_jsonc {
        Some(REASON_JSONC_READONLY.to_string())
    } else {
        spec.readonly_reason_code.map(str::to_string)
    };
    let (command, args_count) = command_and_args(source, spec_object);
    let url = string_field(spec_object, source.fields.url)
        .or_else(|| string_field(spec_object, source.fields.url_alt))
        .map(|url| redact_url(&url));
    let transport = string_field(spec_object, source.fields.transport)
        .or_else(|| string_field(spec_object, source.fields.transport_alt));
    let env_keys = object_keys(spec_object.get(source.fields.env));
    let header_keys = object_keys(spec_object.get(source.fields.headers));
    McpConfigEntry {
        id: format!("{}:{name}", source.id),
        engine: source.engine.to_string(),
        name: name.to_string(),
        source: source.id.to_string(),
        scope: source.scope.to_string(),
        workspace_file: crate::engine_config::mcp::source_in_workspace(source.id),
        path: path.to_string_lossy().into_owned(),
        format: "json".to_string(),
        enabled: entry_enabled(source, spec_object),
        transport,
        command,
        args_count,
        url,
        env_keys,
        header_keys,
        writable,
        readonly_reason: spec.readonly_reason.map(str::to_string),
        readonly_reason_code,
        version: version.to_string(),
    }
}

pub(super) fn string_field(object: &Map<String, Value>, key: &str) -> Option<String> {
    if key.is_empty() {
        return None;
    }
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn command_and_args(
    source: &Source,
    spec_object: &Map<String, Value>,
) -> (Option<String>, usize) {
    let args_field = spec_object
        .get(source.fields.args)
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    match spec_object.get(source.fields.command) {
        Some(Value::String(text)) => {
            let command = text.trim();
            let command = (!command.is_empty()).then(|| command.to_string());
            (command, args_field)
        }
        _ => (None, args_field),
    }
}

fn bool_field(object: &Map<String, Value>, key: &str) -> Option<bool> {
    match object.get(key) {
        Some(Value::Bool(value)) => Some(*value),
        Some(Value::String(text)) => match text.trim().to_ascii_lowercase().as_str() {
            "false" | "0" => Some(false),
            "true" | "1" => Some(true),
            _ => None,
        },
        _ => None,
    }
}

fn entry_enabled(source: &Source, spec_object: &Map<String, Value>) -> bool {
    match source.toggle {
        Some(Toggle::Disabled) => !bool_field(spec_object, "disabled").unwrap_or(false),
        None => true,
    }
}

pub(crate) fn probe_target_from_json(object: &Map<String, Value>, fields: Fields) -> ProbeTarget {
    let (command, args) = command_and_args_raw(object, fields);
    ProbeTarget {
        command,
        args,
        env: string_map(object.get(fields.env)),
        cwd: string_field(object, fields.cwd),
        url: string_field(object, fields.url).or_else(|| string_field(object, fields.url_alt)),
        headers: string_map(object.get(fields.headers)),
        transport: string_field(object, fields.transport)
            .or_else(|| string_field(object, fields.transport_alt)),
        from_workspace: false,
    }
}

pub(crate) fn probe_target_from_toml(
    table: &dyn toml_edit::TableLike,
    fields: Fields,
) -> ProbeTarget {
    let toml_string = |key: &str| -> Option<String> {
        if key.is_empty() {
            return None;
        }
        table
            .get(key)
            .and_then(|item| item.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let toml_map = |key: &str| -> Vec<(String, String)> {
        if key.is_empty() {
            return Vec::new();
        }
        table
            .get(key)
            .and_then(|item| item.as_table_like())
            .map(|table| {
                table
                    .iter()
                    .filter_map(|(key, item)| {
                        item.as_str()
                            .map(|value| (key.to_string(), value.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    ProbeTarget {
        command: toml_string(fields.command),
        args: table
            .get(fields.args)
            .and_then(|item| item.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        env: toml_map(fields.env),
        cwd: toml_string(fields.cwd),
        url: toml_string(fields.url).or_else(|| toml_string(fields.url_alt)),
        headers: toml_map(fields.headers),
        transport: toml_string(fields.transport).or_else(|| toml_string(fields.transport_alt)),
        from_workspace: false,
    }
}

fn string_map(value: Option<&Value>) -> Vec<(String, String)> {
    value
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn command_and_args_raw(
    object: &Map<String, Value>,
    fields: Fields,
) -> (Option<String>, Vec<String>) {
    let args: Vec<String> = object
        .get(fields.args)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    match object.get(fields.command) {
        Some(Value::String(text)) => {
            let command = text.trim();
            let command = (!command.is_empty()).then(|| command.to_string());
            (command, args)
        }
        _ => (None, args),
    }
}

pub(crate) fn probe_target_for_source(
    source: &Source,
    name: &str,
    workspace: Option<&str>,
) -> Result<ProbeTarget, McpError> {
    let path = first_existing(candidate_paths(source.id, workspace)).ok_or_else(|| {
        McpError::not_found("The config file doesn't exist, so there's nothing to connect to")
    })?;
    let missing = || McpError::not_found(format!("The config has no MCP server named “{name}”"));
    let raw = read_text(&path)?;
    let root = if is_jsonc(&path) {
        parse_jsonc(&raw, &path.to_string_lossy())?
    } else {
        parse_json(&raw, &path.to_string_lossy())?
    };
    let object = root
        .get(source.servers_key)
        .and_then(Value::as_object)
        .and_then(|servers| servers.get(name))
        .and_then(Value::as_object)
        .ok_or_else(missing)?;
    Ok(probe_target_from_json(object, source.fields))
}
