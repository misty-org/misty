//! OpenCode 2.x session calls: the models' context windows, MCP servers, the agent and model,
//! and a session's messages.

use std::collections::HashMap;

use reqwest::Method;
use serde_json::{json, Value};

use super::super::opencode_server::data;
use super::super::SendRequest;
use super::call;

/// The most messages one page of `GET /api/session/:id/message` holds.
const PAGE: usize = 200;

/// `provider/model` → context window, from the models the server lists for this folder.
pub(super) async fn context_windows(origin: &str, directory: &str) -> HashMap<String, u64> {
    let Ok(list) = call(Method::GET, origin, "/api/model", Some(directory), None).await else {
        return HashMap::new();
    };
    data(&list)
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let provider = model.get("providerID")?.as_str()?;
            let id = model.get("id")?.as_str()?;
            let window = model.pointer("/limit/context")?.as_u64()?;
            Some((format!("{provider}/{id}"), window))
        })
        .collect()
}

/// Misty's Space server and an agent's own servers, added to this folder's MCP servers
/// (`PUT /api/experimental/mcp/:name`). A server that won't take one only loses those tools.
pub(super) async fn add_mcp_servers(req: &SendRequest, origin: &str, directory: &str) {
    let Some(servers) = req.mcp_servers.as_ref().and_then(Value::as_object) else {
        return;
    };
    for (name, server) in servers {
        let config = match server["command"].as_str() {
            Some(command) => {
                let mut line = vec![json!(command)];
                line.extend(server["args"].as_array().cloned().unwrap_or_default());
                json!({
                    "type": "local",
                    "command": line,
                    "environment": server["env"].as_object().cloned().unwrap_or_default(),
                })
            }
            None => json!({
                "type": "remote",
                "url": server["url"],
                "headers": server["headers"].as_object().cloned().unwrap_or_default(),
            }),
        };
        let _ = call(
            Method::PUT,
            origin,
            &format!("/api/experimental/mcp/{}", path_segment(name)),
            Some(directory),
            Some(json!({ "config": config })),
        )
        .await;
    }
}

/// The session's agent (Plan in Plan mode, else Build) and the chat's model and effort, switched
/// only when they differ from what the session is on: each switch is a line in its history.
pub(super) async fn choose_agent_and_model(
    req: &SendRequest,
    origin: &str,
    session_id: &str,
) -> Result<(), String> {
    let info = call(
        Method::GET,
        origin,
        &format!("/api/session/{session_id}"),
        None,
        None,
    )
    .await?;
    let info = data(&info);
    let current_agent = info.get("agent").and_then(Value::as_str).unwrap_or("build");
    let wanted_agent = if req.permission.as_deref() == Some("plan") {
        "plan"
    } else {
        "build"
    };
    if current_agent != wanted_agent {
        call(
            Method::POST,
            origin,
            &format!("/api/session/{session_id}/agent"),
            None,
            Some(json!({ "agent": wanted_agent })),
        )
        .await
        .map_err(|e| format!("OpenCode didn't switch to the {wanted_agent} agent: {e}"))?;
    }
    let effort = req
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty());
    let current = info.get("model").cloned().unwrap_or(Value::Null);
    let base = match req.model.as_deref().and_then(|m| m.split_once('/')) {
        Some((provider, id)) => Some(json!({ "providerID": provider, "id": id })),
        // An effort alone rides on the session's model, else the server's default one.
        None if effort.is_some() => {
            if current.get("id").is_some() {
                Some(json!({ "providerID": current["providerID"], "id": current["id"] }))
            } else {
                call(Method::GET, origin, "/api/model/default", None, None)
                    .await
                    .ok()
                    .map(|d| json!({ "providerID": data(&d)["providerID"], "id": data(&d)["id"] }))
            }
        }
        None => None,
    };
    let Some(mut wanted) = base else {
        return Ok(());
    };
    if let Some(effort) = effort {
        wanted["variant"] = json!(effort);
    } else if current["providerID"] == wanted["providerID"] && current["id"] == wanted["id"] {
        if let Some(variant) = current.get("variant") {
            wanted["variant"] = variant.clone();
        }
    }
    let same = current["providerID"] == wanted["providerID"]
        && current["id"] == wanted["id"]
        && current.get("variant") == wanted.get("variant");
    if same {
        return Ok(());
    }
    call(
        Method::POST,
        origin,
        &format!("/api/session/{session_id}/model"),
        None,
        Some(json!({ "model": wanted })),
    )
    .await
    .map(|_| ())
    .map_err(|e| format!("OpenCode didn't switch the model, so the session keeps its own: {e}"))
}

/// A session's messages, oldest first, page by page.
pub(crate) async fn messages(origin: &str, session_id: &str) -> Result<Vec<Value>, String> {
    let mut all = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut path = format!("/api/session/{session_id}/message?order=asc&limit={PAGE}");
        if let Some(cursor) = &cursor {
            path.push_str(&format!("&cursor={cursor}"));
        }
        let page = call(Method::GET, origin, &path, None, None).await?;
        let items = data(&page).as_array().cloned().unwrap_or_default();
        let full = items.len() >= PAGE;
        all.extend(items);
        cursor = page
            .pointer("/cursor/next")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if !full || cursor.is_none() {
            return Ok(all);
        }
    }
}

/// A name as one URL path segment: anything but unreserved characters percent-encoded.
pub(crate) fn path_segment(name: &str) -> String {
    name.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}
