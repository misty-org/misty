use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, OnceLock};

use serde_json::{json, Value};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny(String),
}

type Decide =
    dyn Fn(String, String, Value) -> Pin<Box<dyn Future<Output = Decision> + Send>> + Send + Sync;

static DECIDER: OnceLock<Arc<Decide>> = OnceLock::new();

pub(crate) fn install(
    decide: impl Fn(String, String, Value) -> Pin<Box<dyn Future<Output = Decision> + Send>>
        + Send
        + Sync
        + 'static,
) {
    let _ = DECIDER.set(Arc::new(decide));
}

pub(crate) async fn ask(run_id: &str, tool: &str, input: Value) -> Decision {
    match DECIDER.get() {
        Some(decide) => decide(run_id.to_string(), tool.to_string(), input).await,
        None => Decision::Deny("Misty can't approve this right now.".into()),
    }
}

pub(crate) fn answer_control_permission(
    registry: Arc<super::ProcessRegistry>,
    run_id: String,
    request_id: String,
    tool_name: String,
    input: Value,
) {
    tokio::spawn(async move {
        let decision = ask(&run_id, &tool_name, input.clone()).await;
        let response = match decision {
            Decision::Allow => json!({ "behavior": "allow", "updatedInput": input }),
            Decision::Deny(message) => json!({ "behavior": "deny", "message": message }),
        };
        let line = json!({
            "type": "control_response",
            "response": { "subtype": "success", "request_id": request_id, "response": response },
        })
        .to_string();
        let _ = registry.write_line(&run_id, line).await;
    });
}

pub(crate) fn acp_outcome(params: &Value, decision: &Decision) -> Value {
    let wanted: &[&str] = match decision {
        Decision::Allow => &["allow_once", "allow_always"],
        Decision::Deny(_) => &["reject_once", "reject_always"],
    };
    let options = params["options"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    for kind in wanted {
        if let Some(id) = options
            .iter()
            .find(|option| option["kind"].as_str() == Some(kind))
            .and_then(|option| option["optionId"].as_str())
        {
            return json!({ "outcome": { "outcome": "selected", "optionId": id } });
        }
    }
    json!({ "outcome": { "outcome": "cancelled" } })
}

fn acp_subject(params: &Value) -> (String, Value) {
    let call = &params["toolCall"];
    let tool = call["title"]
        .as_str()
        .or_else(|| call["kind"].as_str())
        .unwrap_or("tool")
        .to_string();
    let input = call
        .get("rawInput")
        .cloned()
        .filter(|input| !input.is_null())
        .unwrap_or_else(|| call.clone());
    (tool, input)
}

pub(crate) fn answer_acp_permission(
    registry: Arc<super::ProcessRegistry>,
    run_id: String,
    id: Value,
    params: Value,
) {
    tokio::spawn(async move {
        let (tool, input) = acp_subject(&params);
        let decision = ask(&run_id, &tool, input).await;
        let frame =
            json!({ "jsonrpc": "2.0", "id": id, "result": acp_outcome(&params, &decision) });
        let _ = registry.write_line(&run_id, frame.to_string()).await;
    });
}

#[derive(Clone)]
pub(crate) struct AcpGate {
    registry: Arc<super::ProcessRegistry>,
    run_id: String,
    bypass: bool,
}

impl AcpGate {
    pub(crate) fn of(core: &super::TurnCore, req: &super::SendRequest) -> Self {
        Self {
            registry: Arc::clone(&core.registry),
            run_id: core.run_id.clone(),
            bypass: req.permission.as_deref() == Some("bypass"),
        }
    }
}

pub(crate) fn acp_agent_request(
    gate: Option<&AcpGate>,
    workspace: &std::path::Path,
    id: &Value,
    method: &str,
    params: &Value,
) -> Option<Value> {
    let Some(gate) = gate.filter(|gate| !gate.bypass) else {
        return Some(super::acp_session::answer_agent_request(
            workspace, id, method, params,
        ));
    };
    match method {
        "session/request_permission" => {
            answer_acp_permission(
                Arc::clone(&gate.registry),
                gate.run_id.clone(),
                id.clone(),
                params.clone(),
            );
            None
        }
        "fs/write_text_file" => {
            let (registry, run_id) = (Arc::clone(&gate.registry), gate.run_id.clone());
            let (workspace, id, params) = (workspace.to_path_buf(), id.clone(), params.clone());
            tokio::spawn(async move {
                let input = json!({ "path": params["path"], "content": params["content"] });
                let frame = match ask(&run_id, "Write", input).await {
                    Decision::Allow => super::acp_session::answer_agent_request(
                        &workspace,
                        &id,
                        "fs/write_text_file",
                        &params,
                    ),
                    Decision::Deny(message) => json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32000, "message": message },
                    }),
                };
                let _ = registry.write_line(&run_id, frame.to_string()).await;
            });
            None
        }
        _ => Some(super::acp_session::answer_agent_request(
            workspace, id, method, params,
        )),
    }
}

pub(crate) fn acp_mcp_servers(req: &super::SendRequest, agent: &Value) -> Value {
    let can = |transport: &str| {
        agent["agentCapabilities"]["mcpCapabilities"][transport]
            .as_bool()
            .unwrap_or(false)
    };
    let Some(servers) = req.mcp_servers.as_ref().and_then(Value::as_object) else {
        return json!([]);
    };
    let pairs = |value: &Value| -> Vec<Value> {
        value
            .as_object()
            .into_iter()
            .flatten()
            .map(|(name, value)| json!({ "name": name, "value": value }))
            .collect()
    };
    let list: Vec<Value> = servers
        .iter()
        .filter_map(|(name, server)| {
            if let Some(command) = server["command"].as_str() {
                return Some(json!({
                    "name": name,
                    "command": command,
                    "args": server["args"].as_array().cloned().unwrap_or_default(),
                    "env": pairs(&server["env"]),
                }));
            }
            let transport = if server["type"] == "sse" {
                "sse"
            } else {
                "http"
            };
            if !can(transport) {
                return None;
            }
            Some(json!({
                "type": transport,
                "name": name,
                "url": server["url"].as_str()?,
                "headers": pairs(&server["headers"]),
            }))
        })
        .collect();
    json!(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acp_outcome_picks_the_matching_option_or_cancels() {
        let params = json!({ "options": [
            { "optionId": "a", "kind": "allow_always" },
            { "optionId": "o", "kind": "allow_once" },
            { "optionId": "r", "kind": "reject_once" },
        ]});
        assert_eq!(
            acp_outcome(&params, &Decision::Allow)["outcome"]["optionId"],
            "o"
        );
        assert_eq!(
            acp_outcome(&params, &Decision::Deny("no".into()))["outcome"]["optionId"],
            "r"
        );
        assert_eq!(
            acp_outcome(&json!({ "options": [] }), &Decision::Allow)["outcome"]["outcome"],
            "cancelled"
        );
    }

    #[tokio::test]
    async fn without_a_decider_the_answer_is_no() {
        assert!(matches!(
            ask("run", "Bash", json!({})).await,
            Decision::Deny(_)
        ));
    }
}
