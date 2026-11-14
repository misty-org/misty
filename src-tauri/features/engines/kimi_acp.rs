// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/kimi_acp.rs.
use serde_json::{json, Map, Value};
use std::sync::atomic::AtomicBool;

use super::qoder_session::{
    initialize_params, jsonrpc_id_key, jsonrpc_result_response, AcpProcess, RPC_HANDSHAKE_TIMEOUT,
    SESSION_NEW_TIMEOUT, SESSION_RESUME_TIMEOUT,
};
use super::{Engine, EngineEvent, SendRequest, TurnCore, TurnState};

pub(super) fn selected_model(
    model: Option<&str>,
    command: &tokio::process::Command,
) -> Option<String> {
    if command
        .as_std()
        .get_envs()
        .any(|(key, value)| key == "KIMI_MODEL_API_KEY" && value.is_some())
    {
        Some("__kimi_env_model__".into())
    } else {
        model.map(str::to_string)
    }
}

pub(super) fn initialization() -> Value {
    let mut params = initialize_params();
    params["clientCapabilities"]["elicitation"] = json!({ "form": {} });
    params
}

async fn existing_additional_dirs(dirs: &[String]) -> Result<Vec<&str>, String> {
    let mut existing = Vec::new();
    for dir in dirs {
        match tokio::fs::metadata(dir).await {
            Ok(metadata) if metadata.is_dir() => existing.push(dir.as_str()),
            Ok(_) => eprintln!("[kimi] skipping a granted root that is no longer a directory"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                eprintln!("[kimi] skipping a granted root that no longer exists");
            }
            Err(error) => {
                return Err(format!("Kimi additional directory {dir:?}: {error}"));
            }
        }
    }
    Ok(existing)
}

pub(super) async fn attach_session(
    acp: &mut AcpProcess,
    req: &SendRequest,
    servers: Value,
    killed: &AtomicBool,
) -> Result<(String, Option<String>), String> {
    let mut params = json!({
        "cwd": req.workspace.to_string_lossy(), "mcpServers": servers,
    });
    let (session_id, mut config) = if let Some(session_id) = &req.session_id {
        let mut params = params;
        params["sessionId"] = json!(session_id);
        let result = acp
            .routed(
                "session/load",
                params,
                SESSION_RESUME_TIMEOUT,
                killed,
                None,
                &mut |_| None,
            )
            .await?;
        (session_id.clone(), result)
    } else {
        params["additionalDirectories"] =
            json!(existing_additional_dirs(&req.additional_dirs).await?);
        let result = acp
            .routed(
                "session/new",
                params,
                SESSION_NEW_TIMEOUT,
                killed,
                None,
                &mut |_| None,
            )
            .await?;
        let session_id = result
            .get("sessionId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or("Kimi session handshake returned no sessionId")?
            .to_string();
        (session_id, result)
    };
    if let Some(model) = req.model.as_deref() {
        config = acp
            .routed(
                "session/set_config_option",
                json!({"sessionId": session_id, "configId": "model", "value": model}),
                RPC_HANDSHAKE_TIMEOUT,
                killed,
                None,
                &mut |_| None,
            )
            .await?;
    }
    let mut actual_effort = None;
    if let Some(effort) = req.effort.as_deref() {
        let effort = supported_effort(effort, &config);
        acp.routed(
            "session/set_config_option",
            json!({"sessionId": session_id, "configId": "thinking", "value": effort}),
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut |_| None,
        )
        .await?;
        actual_effort = Some(effort.to_string());
    }
    acp.routed(
        "session/set_mode",
        json!({"sessionId": session_id, "modeId": mode(req.permission.as_deref())}),
        RPC_HANDSHAKE_TIMEOUT,
        killed,
        None,
        &mut |_| None,
    )
    .await?;
    Ok((session_id, actual_effort))
}

/// Kimi's own mode for the run: `default`, where each ask comes back through ACP and Misty's
/// gate answers it, `plan`, or `auto`, where Kimi approves safe operations itself and asks the
/// rest. Its `yolo` mode is never used, since Kimi has no sandbox that keeps it inside its
/// folder (no Bypass).
fn mode(permission: Option<&str>) -> &'static str {
    match super::kimi::KimiEngine.resolve_permission(permission) {
        "plan" => "plan",
        "auto" => "auto",
        _ => "default",
    }
}

fn supported_effort<'a>(requested: &'a str, config: &'a Value) -> &'a str {
    let options = config["configOptions"]
        .as_array()
        .and_then(|options| options.iter().find(|option| option["id"] == "thinking"))
        .and_then(|option| option["options"].as_array());
    let Some(options) = options else {
        return requested;
    };
    let accepts = |value: &str| options.iter().any(|option| option["value"] == value);
    let boolean = options
        .iter()
        .find(|option| option["value"] != "off")
        .is_some_and(|option| option["value"] == "on");
    if boolean && !matches!(requested, "off" | "none") {
        "on"
    } else if accepts(requested) {
        requested
    } else if requested == "none" && accepts("off") {
        "off"
    } else if !matches!(requested, "off" | "none") && accepts("on") {
        "on"
    } else {
        let levels = [
            "off", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
        ];
        let rank = |value: &str| levels.iter().position(|level| *level == value);
        options
            .iter()
            .filter_map(|option| option["value"].as_str())
            .filter(|value| rank(value).is_some())
            .min_by_key(|value| rank(value).unwrap().abs_diff(rank(requested).unwrap_or(4)))
            .or_else(|| options.iter().find_map(|option| option["value"].as_str()))
            .unwrap_or(requested)
    }
}

fn fields(params: &Value) -> Result<Vec<Value>, String> {
    if params.get("mode").and_then(Value::as_str) != Some("form") {
        return Err("Unsupported Kimi elicitation mode".into());
    }
    let schema = &params["requestedSchema"];
    let properties = schema["properties"]
        .as_object()
        .ok_or("Kimi form has no properties")?;
    let required = schema["required"]
        .as_array()
        .ok_or("Kimi form has no field order")?;
    let prompts: Vec<_> = params["message"]
        .as_str()
        .unwrap_or_default()
        .lines()
        .collect();
    required
        .iter()
        .enumerate()
        .map(|(index, key)| {
            let key = key.as_str().ok_or("Invalid Kimi field id")?;
            let field = properties.get(key).ok_or("Missing Kimi field")?;
            let multi = field["type"] == "array";
            let choices = if multi {
                &field["items"]["anyOf"]
            } else {
                &field["oneOf"]
            };
            let choices = choices
                .as_array()
                .filter(|items| !items.is_empty())
                .ok_or("Unsupported Kimi choices")?;
            let options = choices
                .iter()
                .map(|choice| {
                    let label = choice["const"].as_str().ok_or("Invalid Kimi choice")?;
                    Ok(json!({ "label": label, "description": choice["description"] }))
                })
                .collect::<Result<Vec<Value>, String>>()?;
            let header = field["title"].as_str().unwrap_or(key);
            let question = if prompts.len() == required.len() {
                prompts[index].to_string()
            } else {
                format!("Q{} · {}", index + 1, header)
            };
            Ok(json!({
                "key": key, "question": question, "header": header,
                "multiSelect": multi, "allowOther": false, "options": options,
            }))
        })
        .collect()
}

pub(super) fn park_question(
    core: &TurnCore,
    state: &mut TurnState,
    id: &Value,
    params: &Value,
) -> Option<Value> {
    let questions = match fields(params) {
        Ok(questions) if !questions.is_empty() => questions,
        _ => return Some(jsonrpc_result_response(id, json!({ "action": "decline" }))),
    };
    core.dispatch_event(
        state,
        EngineEvent::Question {
            request_id: jsonrpc_id_key(id).unwrap_or_else(|| id.to_string()),
            tool_use_id: params["toolCallId"].as_str().map(str::to_string),
            input: json!({"questions": questions, "kimiAcp": {"rpcId": id, "fields": questions}}),
        },
    );
    None
}

pub(super) fn answer_frame(context: &Value, answers: Option<&Value>) -> Result<Value, String> {
    let id = context
        .get("rpcId")
        .filter(|id| id.is_string() || id.is_number())
        .ok_or("Missing Kimi request id")?;
    let Some(answers) = answers else {
        return Ok(jsonrpc_result_response(id, json!({ "action": "cancel" })));
    };
    let answers = answers
        .as_object()
        .ok_or("Kimi answers must be an object")?;
    let fields = context["fields"]
        .as_array()
        .ok_or("Missing Kimi question fields")?;
    let mut content = Map::new();
    for field in fields {
        let key = field["key"].as_str().ok_or("Missing Kimi field id")?;
        let question = field["question"].as_str().ok_or("Missing Kimi question")?;
        let answer = answers
            .get(question)
            .ok_or("Answer every Kimi question before submitting")?;
        let options = field["options"].as_array().ok_or("Missing Kimi choices")?;
        let valid = |value: &Value| {
            value.is_string()
                && options
                    .iter()
                    .any(|option| option.get("label") == Some(value))
        };
        let accepted = if field["multiSelect"] == true {
            answer
                .as_array()
                .is_some_and(|values| !values.is_empty() && values.iter().all(valid))
        } else {
            valid(answer)
        };
        if !accepted {
            return Err("Kimi only accepts the declared choices for this question".into());
        }
        content.insert(key.into(), answer.clone());
    }
    Ok(jsonrpc_result_response(
        id,
        json!({"action": "accept", "content": content}),
    ))
}

/// ACP's `usage_update`: how full the context is (`used`) out of the model's window (`size`).
/// `used` is sent on by that name too, so a turn's later `totalTokens`, which adds up every call
/// in the turn, doesn't replace it. An empty context's 0 stays out: a bare `used: 0` reads as a
/// compaction the engine didn't size.
pub(super) fn usage(params: &Value) -> Option<Value> {
    let update = &params["update"];
    if update["sessionUpdate"] != "usage_update" {
        return None;
    }
    let used = update["used"].as_u64()?;
    let mut usage = json!({ "input_tokens": used });
    if used > 0 {
        usage["used"] = json!(used);
    }
    if let Some(size) = update["size"].as_u64() {
        usage["model_context_window"] = json!(size);
    }
    Some(usage)
}

#[cfg(test)]
#[path = "kimi_acp_tests.rs"]
mod tests;
