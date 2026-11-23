use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde_json::{json, Map, Value};

static DENIED: LazyLock<Mutex<HashMap<String, Value>>> = LazyLock::new(Default::default);

const SUMMARY_CHARS: usize = 160;

pub(in crate::engines) fn keep(thread: &str, event: Value) {
    if let Ok(mut denied) = DENIED.lock() {
        denied.insert(thread.to_string(), event);
    }
}

pub(in crate::engines) fn take(thread: &str) -> Option<Value> {
    DENIED.lock().ok()?.remove(thread)
}

pub(in crate::engines) fn restore(thread: &str, event: Value) {
    if let Ok(mut denied) = DENIED.lock() {
        denied.entry(thread.to_string()).or_insert(event);
    }
}

pub(in crate::engines) fn core_event(params: &Value) -> Option<Value> {
    let review = params.get("review")?;
    if review.get("status").and_then(Value::as_str) != Some("denied") {
        return None;
    }
    let mut event = Map::new();
    event.insert("id".into(), json!(params.get("reviewId")?.as_str()?));
    event.insert(
        "turn_id".into(),
        json!(params
            .get("turnId")
            .and_then(Value::as_str)
            .unwrap_or_default()),
    );
    event.insert(
        "started_at_ms".into(),
        json!(params
            .get("startedAtMs")
            .and_then(Value::as_i64)
            .unwrap_or(0)),
    );
    if let Some(completed) = params.get("completedAtMs").and_then(Value::as_i64) {
        event.insert("completed_at_ms".into(), json!(completed));
    }
    event.insert("status".into(), json!("denied"));
    copy(&mut event, review, "riskLevel", "risk_level");
    copy(
        &mut event,
        review,
        "userAuthorization",
        "user_authorization",
    );
    copy(&mut event, review, "rationale", "rationale");
    if let Some(source) = params.get("decisionSource").and_then(Value::as_str) {
        event.insert("decision_source".into(), json!(snake(source)));
    }
    event.insert("action".into(), core_action(params.get("action")?)?);
    Some(Value::Object(event))
}

fn core_action(action: &Value) -> Option<Value> {
    let kind = action.get("type")?.as_str()?;
    let mut out = Map::new();
    out.insert("type".into(), json!(snake(kind)));
    let fields: &[(&str, &str)] = match kind {
        "command" => &[("command", "command"), ("cwd", "cwd")],
        "execve" => &[("program", "program"), ("argv", "argv"), ("cwd", "cwd")],
        "applyPatch" => &[("cwd", "cwd"), ("files", "files")],
        "networkAccess" => &[("target", "target"), ("host", "host"), ("port", "port")],
        "mcpToolCall" => &[
            ("server", "server"),
            ("toolName", "tool_name"),
            ("connectorId", "connector_id"),
            ("connectorName", "connector_name"),
            ("toolTitle", "tool_title"),
        ],
        "requestPermissions" => &[("reason", "reason")],
        _ => return None,
    };
    for (from, to) in fields {
        copy(&mut out, action, from, to);
    }
    for key in ["source", "protocol"] {
        if let Some(word) = action.get(key).and_then(Value::as_str) {
            out.insert(key.into(), json!(snake(word)));
        }
    }
    if kind == "requestPermissions" {
        out.insert(
            "permissions".into(),
            core_permissions(action.get("permissions")?),
        );
    }
    Some(Value::Object(out))
}

fn core_permissions(permissions: &Value) -> Value {
    let mut out = Map::new();
    if let Some(network) = present(permissions, "network") {
        out.insert("network".into(), network.clone());
    }
    if let Some(file_system) = present(permissions, "fileSystem") {
        let entries = match file_system.get("entries").and_then(Value::as_array) {
            Some(entries) => entries.clone(),
            None => ["read", "write"]
                .iter()
                .flat_map(|access| {
                    file_system
                        .get(*access)
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .map(move |path| {
                            json!({ "path": { "type": "path", "path": path }, "access": access })
                        })
                })
                .collect(),
        };
        let mut file = Map::new();
        file.insert("entries".into(), Value::Array(entries));
        if let Some(depth) = present(file_system, "globScanMaxDepth") {
            file.insert("glob_scan_max_depth".into(), depth.clone());
        }
        out.insert("file_system".into(), Value::Object(file));
    }
    Value::Object(out)
}

pub(in crate::engines) fn summary(event: &Value) -> String {
    let action = &event["action"];
    let text = |key: &str| action[key].as_str().unwrap_or_default().to_string();
    let summary = match action["type"].as_str().unwrap_or_default() {
        "command" => text("command"),
        "execve" => match action["argv"].as_array().filter(|argv| !argv.is_empty()) {
            Some(argv) => argv
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" "),
            None => text("program"),
        },
        "apply_patch" => match action["files"].as_array().map(Vec::as_slice) {
            Some([file]) => format!("apply_patch touching {}", file.as_str().unwrap_or("a file")),
            Some(files) => format!("apply_patch touching {} files", files.len()),
            None => "apply_patch".to_string(),
        },
        "network_access" => format!("network access to {}", text("target")),
        "mcp_tool_call" => {
            let on = action["connector_name"]
                .as_str()
                .unwrap_or(action["server"].as_str().unwrap_or_default());
            format!("MCP {} on {on}", text("tool_name"))
        }
        "request_permissions" => match action["reason"].as_str() {
            Some(reason) => format!("permission request: {reason}"),
            None => "permission request".to_string(),
        },
        _ => String::new(),
    };
    let summary = summary.split_whitespace().collect::<Vec<_>>().join(" ");
    if summary.chars().count() > SUMMARY_CHARS {
        let cut: String = summary.chars().take(SUMMARY_CHARS).collect();
        format!("{}…", cut.trim_end())
    } else {
        summary
    }
}

pub(in crate::engines) fn notice(event: &Value) -> String {
    let summary = summary(event);
    if summary.is_empty() {
        "Codex's auto-review blocked this action. Type /approve to allow one retry.".to_string()
    } else {
        format!(
            "Codex's auto-review blocked this action: {summary}. Type /approve to allow one retry."
        )
    }
}

fn present<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.get(key).filter(|value| !value.is_null())
}

fn copy(out: &mut Map<String, Value>, from: &Value, key: &str, to: &str) {
    if let Some(value) = present(from, key) {
        out.insert(to.to_string(), value.clone());
    }
}

fn snake(word: &str) -> String {
    let mut out = String::with_capacity(word.len() + 4);
    for character in word.chars() {
        if character.is_ascii_uppercase() {
            out.push('_');
            out.push(character.to_ascii_lowercase());
        } else {
            out.push(character);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notification(status: &str, action: Value) -> Value {
        json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "reviewId": "review-1",
            "targetItemId": "item-1",
            "startedAtMs": 10,
            "completedAtMs": 20,
            "decisionSource": "agent",
            "review": {
                "status": status,
                "riskLevel": "high",
                "userAuthorization": "low",
                "rationale": "Deletes files outside the project."
            },
            "action": action
        })
    }

    #[test]
    fn a_denied_command_becomes_the_core_event() {
        let params = notification(
            "denied",
            json!({ "type": "command", "source": "unifiedExec", "command": "rm -rf /tmp/x", "cwd": "/tmp" }),
        );
        assert_eq!(
            core_event(&params),
            Some(json!({
                "id": "review-1",
                "turn_id": "turn-1",
                "started_at_ms": 10,
                "completed_at_ms": 20,
                "status": "denied",
                "risk_level": "high",
                "user_authorization": "low",
                "rationale": "Deletes files outside the project.",
                "decision_source": "agent",
                "action": {
                    "type": "command",
                    "source": "unified_exec",
                    "command": "rm -rf /tmp/x",
                    "cwd": "/tmp"
                }
            }))
        );
    }

    #[test]
    fn only_a_denial_is_kept() {
        for status in ["inProgress", "approved", "timedOut", "aborted"] {
            let params = notification(status, json!({ "type": "command", "command": "ls" }));
            assert_eq!(core_event(&params), None, "{status}");
        }
    }

    #[test]
    fn other_actions_take_core_names() {
        let network = notification(
            "denied",
            json!({ "type": "networkAccess", "target": "https://x.dev", "host": "x.dev", "protocol": "socks5Tcp", "port": 443 }),
        );
        assert_eq!(
            core_event(&network).unwrap()["action"],
            json!({ "type": "network_access", "target": "https://x.dev", "host": "x.dev", "protocol": "socks5_tcp", "port": 443 })
        );
        let mcp = notification(
            "denied",
            json!({ "type": "mcpToolCall", "server": "github", "toolName": "merge", "connectorId": null, "connectorName": "GitHub", "toolTitle": null }),
        );
        let event = core_event(&mcp).unwrap();
        assert_eq!(
            event["action"],
            json!({ "type": "mcp_tool_call", "server": "github", "tool_name": "merge", "connector_name": "GitHub" })
        );
        assert_eq!(summary(&event), "MCP merge on GitHub");
        let permissions = notification(
            "denied",
            json!({
                "type": "requestPermissions",
                "reason": "write outside",
                "permissions": { "network": null, "fileSystem": { "read": ["/a"], "write": ["/b"], "entries": null } }
            }),
        );
        assert_eq!(
            core_event(&permissions).unwrap()["action"],
            json!({
                "type": "request_permissions",
                "reason": "write outside",
                "permissions": { "file_system": { "entries": [
                    { "path": { "type": "path", "path": "/a" }, "access": "read" },
                    { "path": { "type": "path", "path": "/b" }, "access": "write" }
                ] } }
            })
        );
        let unknown = notification("denied", json!({ "type": "somethingNew" }));
        assert_eq!(core_event(&unknown), None);
    }

    #[test]
    fn the_notice_names_the_action_and_the_command() {
        let params = notification(
            "denied",
            json!({ "type": "applyPatch", "cwd": "/p", "files": ["/p/a.rs", "/p/b.rs"] }),
        );
        assert_eq!(
            notice(&core_event(&params).unwrap()),
            "Codex's auto-review blocked this action: apply_patch touching 2 files. Type /approve to allow one retry."
        );
    }

    #[test]
    fn approving_spends_the_latest_denial_and_a_failed_one_comes_back() {
        let thread = "denials-test-thread";
        keep(thread, json!({ "id": "old" }));
        keep(thread, json!({ "id": "new" }));
        let taken = take(thread).unwrap();
        assert_eq!(taken["id"], "new");
        assert_eq!(take(thread), None);
        restore(thread, taken);
        assert_eq!(take(thread).unwrap()["id"], "new");
    }
}
