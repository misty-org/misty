//! Antigravity's part of the shared ACP turn (`grok_acp.rs`): its handshake (resume, model,
//! thinking level, mode), the model it reports mid-turn, and its question forms.
//!
//! Captured from agy 1.5.9:
//! - `session/set_model {modelId}` takes the ids `agy models` prints (`gemini-3.8-flash-low`),
//!   and answers `{}` after a `config_option_update`. That update names the model by its family
//!   (`gemini-3.8-flash`) with the level apart, as `thought_level`; a model with no levels
//!   (`claude-sonnet-4-6`) lists no `thought_level`, and setting one is refused ("Thinking level
//!   \"high\" is not offered for model …").
//! - `session/resume {sessionId, cwd, mcpServers}` reopens a conversation without replaying it.
//! - An `ask_question` call is a `tool_call`, then `elicitation/create` with `mode: "form"`: one
//!   `q<n>` property per question, whose `oneOf` lists its options as `{const: "1", title:
//!   <label>}`, and a `q<n>_other` string for a free-form answer. The reply is
//!   `{action: "accept", content: {q1: "1"}}`; one declined or cancelled is asked in the chat
//!   instead. A multi-select question is an `array` whose `items` list the options the same way
//!   (MCP's titled multi-select).
//! - `initialize` lists no `mcpCapabilities`, but `session/new` takes an HTTP server and loads it
//!   ("Preloading 1 MCP servers of the session" in its log).

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{json, Map, Value};

use super::AgyEngine;
use crate::engines::qoder_session::{
    initialize_params, jsonrpc_id_key, jsonrpc_result_response, session_state_update, AcpLine,
    AcpProcess, AcpSessionState, RPC_HANDSHAKE_TIMEOUT, SESSION_NEW_TIMEOUT,
    SESSION_RESUME_TIMEOUT,
};
use crate::engines::{Engine, EngineEvent, SendRequest, TurnCore, TurnState};

/// The thinking levels a request may name, lowest first, to find the nearest one a model offers.
const LEVELS: &[&str] = &["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

/// `initialize` with form elicitation on, so `ask_question` reaches the person as a form instead
/// of being asked in the chat.
pub(crate) fn initialization() -> Value {
    let mut params = initialize_params();
    params["clientCapabilities"]["elicitation"] = json!({ "form": {} });
    params
}

/// The agent's `initialize` answer with HTTP MCP servers allowed, which agy takes without
/// listing them, so Misty's own server is mounted (`gate::acp_mcp_servers`).
pub(crate) fn mcp_capable(agent: &Value) -> Value {
    let mut agent = agent.clone();
    if agent.get("agentCapabilities").is_some_and(Value::is_object) {
        agent["agentCapabilities"]["mcpCapabilities"]["http"] = json!(true);
    }
    agent
}

/// Reopens the chat's conversation (or opens one), then puts it in the run's model, thinking
/// level and mode. Returns the session id and the thinking level set when it isn't the one asked
/// for. A conversation Antigravity no longer has opens fresh, so the message isn't lost.
pub(crate) async fn attach_session(
    acp: &mut AcpProcess,
    req: &SendRequest,
    servers: Value,
    killed: &AtomicBool,
) -> Result<(String, Option<String>), String> {
    let cwd = req.workspace.to_string_lossy().to_string();
    let mut attached = None;
    if let Some(session_id) = req.session_id.as_deref() {
        let params = json!({ "sessionId": session_id, "cwd": cwd, "mcpServers": servers.clone() });
        match call(
            acp,
            "session/resume",
            params,
            SESSION_RESUME_TIMEOUT,
            killed,
        )
        .await
        {
            Ok(result) => attached = Some((session_id.to_string(), result)),
            // An interrupt isn't a failed resume: a new session would start work just cancelled.
            Err(error) if killed.load(Ordering::SeqCst) => return Err(error),
            Err(_) => {}
        }
    }
    let (session_id, result) = match attached {
        Some(attached) => attached,
        None => {
            let params = json!({ "cwd": cwd, "mcpServers": servers });
            let result = call(acp, "session/new", params, SESSION_NEW_TIMEOUT, killed).await?;
            let id = result
                .get("sessionId")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .ok_or("Antigravity's session handshake returned no sessionId")?
                .to_string();
            (id, result)
        }
    };
    let mut options = result.get("configOptions").cloned().unwrap_or(Value::Null);
    let model = non_empty(req.model.as_deref());
    if let Some(model) = model {
        // The options the new model has arrive in a `config_option_update` before the answer.
        let mut follow = |line: &AcpLine| {
            if let AcpLine::Notification { params, .. } = line {
                if params["update"]["sessionUpdate"] == "config_option_update" {
                    options = params["update"]["configOptions"].clone();
                }
            }
            None
        };
        acp.routed(
            "session/set_model",
            json!({ "sessionId": session_id, "modelId": model }),
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut follow,
        )
        .await?;
    }
    let mut applied = None;
    let effort = non_empty(req.effort.as_deref()).filter(|_| !model.is_some_and(encodes_effort));
    if let Some(level) = effort.and_then(|effort| nearest_level(effort, &options)) {
        let params =
            json!({ "sessionId": session_id, "configId": "thought_level", "value": level });
        call(
            acp,
            "session/set_config_option",
            params,
            RPC_HANDSHAKE_TIMEOUT,
            killed,
        )
        .await?;
        applied = Some(level);
    }
    let mode = mode_id(req.permission.as_deref());
    let params = json!({ "sessionId": session_id, "modeId": mode });
    call(
        acp,
        "session/set_mode",
        params,
        RPC_HANDSHAKE_TIMEOUT,
        killed,
    )
    .await?;
    Ok((session_id, applied))
}

async fn call(
    acp: &mut AcpProcess,
    method: &str,
    params: Value,
    timeout: std::time::Duration,
    killed: &AtomicBool,
) -> Result<Value, String> {
    acp.routed(method, params, timeout, killed, None, &mut |_| None)
        .await
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// Antigravity's own mode for the run's launch level (`AgyEngine::modes`).
fn mode_id(permission: Option<&str>) -> &'static str {
    let level = AgyEngine.resolve_permission(permission);
    AgyEngine
        .modes()
        .iter()
        .find(|mode| mode.launch == level)
        .map_or("default", |mode| mode.id)
}

/// A model id that names its own level (`gemini-3.8-flash-high`) takes no separate one.
fn encodes_effort(model: &str) -> bool {
    let lower = model.to_ascii_lowercase();
    ["-minimal", "-low", "-medium", "-high", "-xhigh", "-max"]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
}

/// The session's `thought_level` choice nearest the one asked for, or None when the model has
/// no levels.
fn nearest_level(requested: &str, options: &Value) -> Option<String> {
    let choices: Vec<&str> = options
        .as_array()?
        .iter()
        .find(|option| option["id"] == "thought_level" || option["category"] == "thought_level")?
        .get("options")?
        .as_array()?
        .iter()
        .filter_map(|choice| choice["value"].as_str())
        .collect();
    if let Some(same) = choices
        .iter()
        .find(|choice| choice.eq_ignore_ascii_case(requested))
    {
        return Some(same.to_string());
    }
    let rank = |value: &str| {
        LEVELS
            .iter()
            .position(|level| level.eq_ignore_ascii_case(value))
    };
    let wanted = rank(requested)?;
    choices
        .iter()
        .filter_map(|choice| Some((rank(choice)?.abs_diff(wanted), *choice)))
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, choice)| choice.to_string())
}

/// Reports what a `session/update` says about the session, as `qoder_session` does, with the
/// model named the way `agy models` names it: its family and thinking level joined
/// (`gemini-3.8-flash` at `low` is `gemini-3.8-flash-low`), so the composer keeps an id Misty's
/// model list has.
pub(crate) fn report_session_state(core: &TurnCore, state: &mut TurnState, params: &Value) {
    let Some(update) = session_state_update(params) else {
        return;
    };
    for event in AcpSessionState::default().follow(with_model_id(update)) {
        core.dispatch_event(state, event);
    }
}

fn with_model_id(mut update: AcpSessionState) -> AcpSessionState {
    if let (Some(model), Some(level)) = (update.model.as_deref(), update.effort.as_deref()) {
        if !encodes_effort(model) {
            update.model = Some(format!("{model}-{level}"));
            update.effort = None;
        }
    }
    update
}

/// One question of a form, as the card shows it and as the answer needs it.
fn fields(params: &Value) -> Option<Vec<Value>> {
    if params["mode"] != "form" {
        return None;
    }
    let properties = params["requestedSchema"]["properties"].as_object()?;
    let mut keys: Vec<&String> = properties
        .keys()
        .filter(|key| {
            !key.strip_suffix("_other")
                .is_some_and(|base| properties.contains_key(base))
        })
        .collect();
    // `q2` before `q10`: the schema's keys come back sorted as text.
    keys.sort_by_key(|key| {
        let digits: String = key.chars().filter(char::is_ascii_digit).collect();
        (digits.parse::<u64>().unwrap_or(u64::MAX), key.to_string())
    });
    let fields: Vec<Value> = keys
        .into_iter()
        .enumerate()
        .map(|(index, key)| {
            let field = &properties[key];
            let multi = field["type"] == "array";
            let holder = if multi { &field["items"] } else { field };
            let choices: Vec<(Value, String)> = ["oneOf", "anyOf"]
                .iter()
                .find_map(|list| holder[*list].as_array())
                .map(|list| {
                    list.iter()
                        .filter(|choice| !choice["const"].is_null())
                        .map(|choice| {
                            let label = choice["title"].as_str().map(str::to_string);
                            let value = choice["const"].clone();
                            let label = label.unwrap_or_else(|| plain(&value));
                            (value, label)
                        })
                        .collect()
                })
                .or_else(|| {
                    holder["enum"].as_array().map(|list| {
                        list.iter().map(|value| (value.clone(), plain(value))).collect()
                    })
                })
                .unwrap_or_default();
            let other = format!("{key}_other");
            let question = field["title"]
                .as_str()
                .or_else(|| params["message"].as_str())
                .unwrap_or_default();
            json!({
                "key": key,
                "question": question,
                "header": format!("Q{}", index + 1),
                "multiSelect": multi,
                "options": choices.iter().map(|(_, label)| json!({ "label": label })).collect::<Vec<_>>(),
                "values": choices.iter().map(|(value, _)| value.clone()).collect::<Vec<_>>(),
                "other": properties.contains_key(&other).then_some(other),
            })
        })
        .collect();
    (!fields.is_empty()).then_some(fields)
}

fn plain(value: &Value) -> String {
    value
        .as_str()
        .map_or_else(|| value.to_string(), str::to_string)
}

/// Parks one `elicitation/create` as a question card; the answer is written by the shared
/// driver's `answer_frame` through the `grokAcp` context. A form Misty can't read is declined at
/// once, and agy asks in the chat instead.
pub(crate) fn park_question(
    core: &TurnCore,
    state: &mut TurnState,
    id: &Value,
    params: &Value,
) -> Option<Value> {
    let Some(fields) = fields(params) else {
        return Some(jsonrpc_result_response(id, json!({ "action": "decline" })));
    };
    let questions: Vec<Value> = fields
        .iter()
        .map(|field| {
            json!({
                "question": field["question"],
                "header": field["header"],
                "multiSelect": field["multiSelect"],
                "options": field["options"],
            })
        })
        .collect();
    core.dispatch_event(
        state,
        EngineEvent::Question {
            request_id: jsonrpc_id_key(id).unwrap_or_else(|| id.to_string()),
            tool_use_id: params["toolCallId"].as_str().map(str::to_string),
            input: json!({
                "questions": questions,
                "grokAcp": { "rpcId": id, "agyForm": fields },
            }),
        },
    );
    None
}

/// The reply to one parked form: each picked label as its option's value, and words of the
/// person's own in the question's free-form field. A skipped card is `cancel`, which agy follows
/// by asking in the chat.
pub(crate) fn answer_frame(
    id: &Value,
    fields: &Value,
    answers: Option<&Value>,
) -> Result<Value, String> {
    let Some(answers) = answers else {
        return Ok(jsonrpc_result_response(id, json!({ "action": "cancel" })));
    };
    let answers = answers
        .as_object()
        .ok_or("Antigravity's answers must be keyed by the question")?;
    let mut content = Map::new();
    for field in fields.as_array().ok_or("Antigravity's form is missing")? {
        let key = field["key"]
            .as_str()
            .ok_or("Antigravity's form has no field id")?;
        let Some(answer) = answers.get(field["question"].as_str().unwrap_or_default()) else {
            continue;
        };
        let given: Vec<&str> = match answer {
            Value::String(text) => vec![text.as_str()],
            Value::Array(list) => list.iter().filter_map(Value::as_str).collect(),
            _ => return Err("Antigravity's answer must be a label or a list of labels".into()),
        };
        let mut picked = Vec::new();
        let mut own = Vec::new();
        for text in given {
            let at = field["options"]
                .as_array()
                .and_then(|options| options.iter().position(|option| option["label"] == text));
            match at.map(|at| field["values"][at].clone()) {
                Some(value) => picked.push(value),
                None => own.push(text),
            }
        }
        let has_options = field["options"]
            .as_array()
            .is_some_and(|options| !options.is_empty());
        if field["multiSelect"] == true {
            if !picked.is_empty() {
                content.insert(key.into(), Value::Array(picked));
            }
        } else if let Some(value) = picked.into_iter().next() {
            content.insert(key.into(), value);
        }
        if own.is_empty() {
            continue;
        }
        match field["other"].as_str() {
            Some(other) => {
                content.insert(other.into(), json!(own.join("; ")));
            }
            None if !has_options => {
                content.insert(key.into(), json!(own.join("; ")));
            }
            None => return Err("This question only takes one of its options".into()),
        }
    }
    Ok(jsonrpc_result_response(
        id,
        json!({ "action": "accept", "content": content }),
    ))
}

#[cfg(test)]
#[path = "agy_acp_tests.rs"]
mod tests;
