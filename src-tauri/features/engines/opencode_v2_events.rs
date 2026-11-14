//! OpenCode 2.x event projection: one event-stream frame into the turn's events.

use reqwest::Method;
use serde_json::{json, Value};

use super::forms::park_form;
use super::{call, EngineEvent, TurnCore, TurnState, View};

#[allow(clippy::too_many_arguments)]
pub(super) async fn handle_event(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut View,
    value: &Value,
    origin: &str,
    directory: &str,
    session_id: &str,
    permission_reply: &str,
) {
    let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
    let event = value.get("data").cloned().unwrap_or(Value::Null);
    let text = |key: &str| event.get(key).and_then(Value::as_str).unwrap_or("");
    match kind {
        "session.text.delta" | "session.compaction.delta" => {
            let delta = text(if kind == "session.text.delta" {
                "delta"
            } else {
                "text"
            });
            if !delta.is_empty() {
                core.dispatch_event(state, EngineEvent::Delta(delta.to_string()));
            }
        }
        "session.reasoning.delta" => {
            if !text("delta").is_empty() {
                core.dispatch_event(state, EngineEvent::Thinking(text("delta").to_string()));
            }
        }
        "session.step.started" => view.model = model_of(&event),
        "session.step.ended" | "session.compaction.ended" => {
            // A compaction runs no step, so its model comes with its end.
            if let Some(model) = model_of(&event) {
                view.model = Some(model);
            }
            let tokens = event.get("tokens").filter(|t| t.is_object());
            let compacted = kind == "session.compaction.ended";
            if tokens.is_some() || compacted {
                let window = view
                    .model
                    .as_ref()
                    .and_then(|model| view.context_windows.get(model))
                    .copied();
                let usage = usage_of(tokens.unwrap_or(&Value::Null), window);
                let mut usage = if compacted {
                    after_compaction(usage)
                } else {
                    usage
                };
                // Each step reports what it alone cost (from the model's price list), and the
                // message keeps the last report, so the report carries the turn's total so far.
                if let Some(cost) = event
                    .get("cost")
                    .and_then(Value::as_f64)
                    .filter(|cost| cost.is_finite() && *cost >= 0.0)
                {
                    view.cost = Some(view.cost.unwrap_or(0.0) + cost);
                }
                if let Some(cost) = view.cost {
                    usage["cost_usd"] = json!(cost);
                }
                view.last_usage = Some(usage.clone());
                core.dispatch_event(state, EngineEvent::Usage(usage));
            }
        }
        "session.step.failed" | "session.compaction.failed" => {
            if let Some(message) = error_message(&event) {
                core.dispatch_event(state, EngineEvent::Warn(message));
            }
        }
        "session.tool.input.started" => {
            view.tools
                .insert(text("id").to_string(), text("name").to_string());
        }
        "session.tool.called" => {
            let name = tool_name(view, text("id"));
            core.dispatch_event(
                state,
                crate::engines::tool_call_message_with_id(
                    name,
                    event.get("input"),
                    Some(text("id")),
                ),
            );
        }
        "session.tool.success" | "session.tool.failed" => {
            let name = tool_name(view, text("id"));
            let output = tool_text(&event);
            let result = if kind == "session.tool.failed" {
                let message = error_message(&event).unwrap_or_else(|| "tool error".to_string());
                let text = if output.is_empty() {
                    message
                } else {
                    format!("{message}\n{output}")
                };
                json!({ "text": text, "isError": true })
            } else {
                Value::String(output)
            };
            core.dispatch_event(
                state,
                crate::engines::tool_result_patch_with_id(name, Some(&result), Some(text("id"))),
            );
        }
        "session.retry.scheduled" => {
            core.dispatch_event(
                state,
                EngineEvent::Retry {
                    attempt: event.get("attempt").and_then(Value::as_u64).unwrap_or(0),
                    max: 0,
                    message: error_message(&event).unwrap_or_default(),
                },
            );
        }
        "session.execution.started" => {
            view.started = true;
            // Clears any retry line on the run status.
            core.dispatch_event(
                state,
                EngineEvent::Retry {
                    attempt: 0,
                    max: 0,
                    message: String::new(),
                },
            );
        }
        "session.execution.succeeded" | "session.execution.interrupted" => {
            view.turn_ended = true;
        }
        "session.idle" if view.started => view.turn_ended = true,
        "session.execution.failed" => {
            view.turn_ended = true;
            let message =
                error_message(&event).unwrap_or_else(|| "OpenCode session error".to_string());
            core.dispatch_event(state, EngineEvent::Error(message));
        }
        "form.created" => {
            if let Some(form) = event.get("form") {
                park_form(core, state, form, origin, directory);
            }
        }
        "form.replied" | "form.cancelled" => {
            core.dispatch_event(
                state,
                EngineEvent::QuestionSettled {
                    request_id: text("id").to_string(),
                },
            );
        }
        "permission.asked" => {
            let request_id = text("id");
            if request_id.is_empty() {
                return;
            }
            let path = format!("/api/session/{session_id}/permission/{request_id}/reply");
            if permission_reply == "always" {
                let _ = call(
                    Method::POST,
                    origin,
                    &path,
                    None,
                    Some(json!({ "decision": "always" })),
                )
                .await;
                return;
            }
            let tool = event
                .get("action")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let mut input = event.get("metadata").cloned().unwrap_or_else(|| json!({}));
            if let (Some(object), Some(resources)) = (input.as_object_mut(), event.get("resources"))
            {
                object
                    .entry("resources")
                    .or_insert_with(|| resources.clone());
            }
            let (run_id, origin) = (core.run_id.clone(), origin.to_string());
            tokio::spawn(async move {
                let body = match crate::engines::gate::ask(&run_id, &tool, input).await {
                    crate::engines::gate::Decision::Allow => json!({ "decision": "once" }),
                    crate::engines::gate::Decision::Deny(message) => {
                        json!({ "decision": "reject", "message": message })
                    }
                };
                let _ = call(Method::POST, &origin, &path, None, Some(body)).await;
            });
        }
        _ => {}
    }
}

/// The `provider/model` an event names.
fn model_of(event: &Value) -> Option<String> {
    let provider = event.pointer("/model/providerID").and_then(Value::as_str)?;
    let model = event.pointer("/model/id").and_then(Value::as_str)?;
    Some(format!("{provider}/{model}"))
}

/// A step's `tokens` (`{input, output, reasoning, cache: {read, write}}`, input not counting the
/// cache) as the usage the context bar reads. Passed through as they come, the cache sits one
/// level down where the bar doesn't look, and a cached turn read as a few hundred tokens.
pub(crate) fn usage_of(tokens: &Value, window: Option<u64>) -> Value {
    let count = |pointer: &str| tokens.pointer(pointer).and_then(Value::as_u64).unwrap_or(0);
    let mut usage = json!({
        "input_tokens": count("/input"),
        "output_tokens": count("/output"),
        "reasoning_tokens": count("/reasoning"),
        "cache_read_input_tokens": count("/cache/read"),
        "cache_creation_input_tokens": count("/cache/write"),
    });
    if let Some(window) = window {
        usage["model_context_window"] = json!(window);
    }
    usage
}

/// A compaction's usage with the context count cleared. Its tokens are the summarizing call's,
/// so what it read is the context from before, and OpenCode reports no compacted size (2.3.0's
/// `session.compaction.ended` carries only that call's tokens). `used: 0` tells the bar the size
/// is unknown until the next step reports one; the tokens still count toward what the chat spent.
pub(crate) fn after_compaction(mut usage: Value) -> Value {
    usage["used"] = json!(0);
    usage
}

fn tool_name(view: &View, id: &str) -> String {
    view.tools
        .get(id)
        .filter(|name| !name.is_empty())
        .cloned()
        .unwrap_or_else(|| "tool".to_string())
}

/// A tool's text output: its text contents, a file content as its name or address.
pub(super) fn tool_text(event: &Value) -> String {
    event
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(
            |content| match content.get("type").and_then(Value::as_str) {
                Some("text") => content.get("text").and_then(Value::as_str),
                Some("file") => content
                    .get("name")
                    .and_then(Value::as_str)
                    .or_else(|| content.get("uri").and_then(Value::as_str)),
                _ => None,
            },
        )
        .collect::<Vec<_>>()
        .join("\n")
}

/// A 2.x structured error's message (`{error: {type, message}}`).
fn error_message(event: &Value) -> Option<String> {
    event
        .pointer("/error/message")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(str::to_string)
}
