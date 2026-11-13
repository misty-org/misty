// An agent's own MCP servers, looked up in the person's MCP configs on this computer and mounted
// beside Misty's.

use serde_json::{json, Value};

/// The user-level config files an agent's servers are looked up in, the engine's own scope order
/// kept (`engine_config/mcp/launch.rs`). Files inside the project folder are left out: they came
/// with the repository, and starting a server from one is the person's call in the engine itself.
const AGENT_SERVER_SOURCES: &[&str] = &[
    "claude_local",
    "claude_user",
    "codex_user",
    "kimi_user",
    "grok_user",
    "opencode_user",
    "agy_user",
];

/// An MCP client accepts a server name of letters, digits, `_` and `-`.
fn plain_server_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// An agent's own MCP servers (`engine.mcp_servers`, by name), as the engine-neutral config the
/// adapters mount beside Misty's (`{"type": "stdio", "command", "args", "env", "cwd"}` or
/// `{"type": "http", "url", "headers"}`). Each name is looked up in the person's MCP configs on
/// this computer. One the engine's own config already has is left to the engine, which starts it
/// by itself; a name found nowhere is left out.
pub(crate) fn agent_servers(
    engine: &str,
    workspace: &str,
    names: &[String],
) -> serde_json::Map<String, Value> {
    let mut servers = serde_json::Map::new();
    let workspace = Some(workspace);
    for name in names.iter().map(|name| name.trim()).take(16) {
        if !plain_server_name(name) || name == crate::engine_config::mcp::MISTY_SERVER_NAME {
            continue;
        }
        let own = |source: &str| {
            source.starts_with(&format!("{engine}_"))
                || (engine == "codebuddy" && source.starts_with("claude_"))
                || (matches!(engine, "gemini" | "qwen") && source.starts_with("agy_"))
        };
        let mut found = None;
        // The engine's own files first: a server it already has is its own to start.
        let ordered = AGENT_SERVER_SOURCES
            .iter()
            .filter(|source| own(source))
            .chain(AGENT_SERVER_SOURCES.iter().filter(|source| !own(source)));
        for source in ordered {
            let Ok(target) =
                crate::engine_config::mcp::probe_target(&format!("{source}:{name}"), workspace)
            else {
                continue;
            };
            if target.from_workspace {
                continue;
            }
            found = (!own(source)).then_some(target);
            break;
        }
        let Some(target) = found else {
            continue;
        };
        let pairs = |list: &[(String, String)]| {
            list.iter()
                .map(|(key, value)| (key.clone(), Value::String(value.clone())))
                .collect::<serde_json::Map<String, Value>>()
        };
        let server = match target.kind() {
            "stdio" => {
                let Some(command) = target.command.clone() else {
                    continue;
                };
                let mut server =
                    json!({ "type": "stdio", "command": command, "args": target.args });
                if !target.env.is_empty() {
                    server["env"] = Value::Object(pairs(&target.env));
                }
                if let Some(cwd) = &target.cwd {
                    server["cwd"] = json!(cwd);
                }
                server
            }
            "http" => {
                let Some(url) = target.url.clone() else {
                    continue;
                };
                let kind = if target.transport.as_deref() == Some("sse") {
                    "sse"
                } else {
                    "http"
                };
                json!({ "type": kind, "url": url, "headers": Value::Object(pairs(&target.headers)) })
            }
            _ => continue,
        };
        servers.insert(name.to_string(), server);
    }
    servers
}
