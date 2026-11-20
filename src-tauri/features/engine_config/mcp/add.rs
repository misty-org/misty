// Adding an MCP server to an engine, with the engine's own `mcp add` command, so the engine writes
// its own config the way its CLI always does. Misty keeps no copy: the values (an env var, a
// header) go only to that engine's CLI, and nothing here logs them.

use serde::Deserialize;
use std::time::Duration;

use super::{person_window, McpError, MISTY_SERVER_NAME};
use crate::engine_config::marketplace::run_ok;

/// `mcp add` writes one config file; the CLI may check the server first.
const ADD_LIMIT: Duration = Duration::from_secs(60);

/// The engines whose CLI adds servers with `mcp add` the way this file speaks it.
const ENGINES: &[&str] = &["claude", "codex"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "transport")]
pub enum McpAddTarget {
    /// A command the engine starts.
    #[serde(rename = "stdio")]
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
    },
    /// A server at an address (streamable HTTP).
    #[serde(rename = "http")]
    Http { url: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAddRequest {
    pub engine: String,
    pub name: String,
    pub target: McpAddTarget,
    /// `KEY=value` pairs for a command's environment.
    #[serde(default)]
    pub env: Vec<(String, String)>,
    /// `Name: value` pairs sent to an address (Claude Code only).
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    /// Claude Code's scope: `user` (every project) or `local` (this folder). Codex has one.
    #[serde(default)]
    pub scope: Option<String>,
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && !name.starts_with('-')
}

fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        && !key.starts_with('-')
}

/// Adds one server to one engine with that engine's own command.
#[tauri::command]
pub async fn engine_mcp_add(
    webview: tauri::Webview,
    request: McpAddRequest,
) -> Result<(), McpError> {
    person_window(&webview)?;
    let engine = ENGINES
        .iter()
        .copied()
        .find(|known| *known == request.engine.trim())
        .ok_or_else(|| McpError::invalid("This agent can't add servers from Misty."))?;
    let name = request.name.trim();
    if !valid_name(name) {
        return Err(McpError::invalid(
            "Use letters, numbers, - and _ for the name, up to 64.",
        ));
    }
    if name == MISTY_SERVER_NAME {
        return Err(McpError::invalid("Misty's own server is managed by Misty."));
    }
    if request.env.iter().any(|(key, _)| !valid_key(key))
        || request.headers.iter().any(|(key, _)| !valid_key(key))
    {
        return Err(McpError::invalid("A variable or header name has characters it can't use."));
    }

    let env: Vec<String> = request.env.iter().map(|(k, v)| format!("{k}={v}")).collect();
    let headers: Vec<String> = request.headers.iter().map(|(k, v)| format!("{k}: {v}")).collect();
    let mut args: Vec<String> = vec!["mcp".into(), "add".into()];
    match (engine, &request.target) {
        ("claude", target) => {
            let scope = match request.scope.as_deref() {
                Some("local") => "local",
                _ => "user",
            };
            args.extend(["--scope".into(), scope.into()]);
            for pair in &env {
                args.extend(["--env".into(), pair.clone()]);
            }
            match target {
                McpAddTarget::Stdio { command, args: rest } => {
                    if command.trim().is_empty() {
                        return Err(McpError::invalid("The server needs a command."));
                    }
                    args.extend(["--transport".into(), "stdio".into(), name.into(), "--".into()]);
                    args.push(command.trim().into());
                    args.extend(rest.iter().cloned());
                }
                McpAddTarget::Http { url } => {
                    if !(url.starts_with("https://") || url.starts_with("http://")) {
                        return Err(McpError::invalid("The address must start with https://."));
                    }
                    for header in &headers {
                        args.extend(["--header".into(), header.clone()]);
                    }
                    args.extend(["--transport".into(), "http".into(), name.into(), url.clone()]);
                }
            }
        }
        (_, McpAddTarget::Stdio { command, args: rest }) => {
            if command.trim().is_empty() {
                return Err(McpError::invalid("The server needs a command."));
            }
            args.push(name.into());
            for pair in &env {
                args.extend(["--env".into(), pair.clone()]);
            }
            args.push("--".into());
            args.push(command.trim().into());
            args.extend(rest.iter().cloned());
        }
        (_, McpAddTarget::Http { url }) => {
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                return Err(McpError::invalid("The address must start with https://."));
            }
            if !headers.is_empty() {
                return Err(McpError::invalid("Codex takes no headers here; use its config."));
            }
            args.extend([name.into(), "--url".into(), url.clone()]);
        }
    }

    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_ok(engine, &refs, ADD_LIMIT)
        .await
        .map(|_| ())
        .map_err(|message| McpError::new("engine", message))
}
