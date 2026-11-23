use serde_json::{json, Value};

const AGENT_SERVER_SOURCES: &[&str] = &[
    "claude_local",
    "claude_user",
    "codex_user",
    "kimi_user",
    "grok_user",
    "opencode_user",
    "agy_user",
];

fn plain_server_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

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
