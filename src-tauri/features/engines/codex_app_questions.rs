// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/codex_app.rs.
//! The app-server's questions: the cards each one becomes, where it is parked while the person
//! answers, and the frame that carries the answer back.

use std::sync::atomic::Ordering;

use serde_json::{json, Map, Value};

use super::super::qoder_session::jsonrpc_result_response;
use super::super::{EngineEvent, TurnCore, TurnState};
use super::NEXT_ASYNC_QUESTION_RPC_ID;

/// Park a user-input request: publish the card, then remember how to answer it.
pub(super) fn park_question(
    core: &TurnCore,
    state: &mut TurnState,
    id: &Value,
    params: &Value,
    cards: Vec<Value>,
    ids: Value,
) {
    // The registry key is the string form of the rpc id — the same key
    // `QuestionSettled` removes and the run's question map is keyed by.
    let request_id = id.to_string();
    let tool_use_id = params
        .get("itemId")
        .and_then(Value::as_str)
        .map(str::to_string);
    core.dispatch_event(
        state,
        EngineEvent::Question {
            request_id: request_id.clone(),
            tool_use_id,
            input: json!({ "questions": cards }),
        },
    );
    // `dispatch_event` parked the raw event input; replace it with the context
    // the answer command needs — the rpc id to answer plus the question-text →
    // question-id map its response is keyed by. The cards themselves are
    // already in the UI's hands, so only the protocol half is kept here.
    if let Some(entry) = core.registry.get(&core.run_id) {
        entry.questions.lock().unwrap().insert(
            request_id,
            json!({ "codexApp": { "rpcId": id, "ids": ids } }),
        );
    }
}

/// Turns an app-server AgentMessage's async question metadata into question card data.
pub(super) fn async_question_cards(item: &Value) -> Vec<Value> {
    let Some(questions) = item.get("questions").and_then(Value::as_array) else {
        return Vec::new();
    };
    questions
        .iter()
        .enumerate()
        .filter_map(|(index, question)| {
            let title = question
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|title| !title.is_empty())?;
            let options = question
                .get("options")
                .and_then(Value::as_array)
                .map(|options| {
                    options
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|label| !label.is_empty())
                        .map(|label| json!({ "label": label }))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some(json!({
                "question": title,
                "header": format!("Q{}", index + 1),
                "options": options,
            }))
        })
        .collect()
}

/// Publishes an async question, keeping the app-server ids needed to steer the turn with the answer.
pub(super) fn park_async_question(
    core: &TurnCore,
    state: &mut TurnState,
    request_id: &str,
    thread_id: &str,
    turn_id: &str,
    cards: Vec<Value>,
) {
    let input = json!({ "questions": cards });
    core.dispatch_event(
        state,
        EngineEvent::Question {
            request_id: request_id.to_string(),
            tool_use_id: Some(request_id.to_string()),
            input: input.clone(),
        },
    );
    if let Some(entry) = core.registry.get(&core.run_id) {
        if let Ok(mut questions) = entry.questions.lock() {
            questions.insert(
                request_id.to_string(),
                json!({
                    "codexAppAsync": {
                        "callId": request_id,
                        "threadId": thread_id,
                        "turnId": turn_id,
                        "questions": input["questions"],
                    }
                }),
            );
        }
    }
}

/// Builds the `turn/steer` request that answers an async question. The app-server attaches
/// these questions to an AgentMessage rather than holding a server request open, so the answer
/// goes to the current turn as user input, with the original call id kept in the text.
pub(in crate::engines) fn async_answer_request(
    parked: &Value,
    rpc_id: &str,
    answers: Option<&Value>,
) -> Result<Value, String> {
    let call_id = parked
        .get("callId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "async question context is missing the call id".to_string())?;
    let thread_id = parked
        .get("threadId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "async question context is missing the thread id".to_string())?;
    let turn_id = parked
        .get("turnId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "async question context is missing the turn id".to_string())?;
    let message = match answers {
        None => format!("The user skipped your async question (call_id: {call_id})."),
        Some(answers) => {
            let answer_map = answers
                .as_object()
                .ok_or_else(|| "Codex answers must be an object".to_string())?;
            let question_titles: std::collections::HashSet<&str> = parked
                .get("questions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|question| question.get("question").and_then(Value::as_str))
                .collect();
            if let Some(unknown) = answer_map
                .keys()
                .find(|title| !question_titles.contains(title.as_str()))
            {
                return Err(format!("Codex did not ask a question titled {unknown:?}"));
            }
            for value in answer_map.values() {
                let valid = value.as_str().is_some()
                    || value
                        .as_array()
                        .is_some_and(|labels| labels.iter().all(Value::is_string));
                if !valid {
                    return Err("Codex answers must contain strings or arrays of strings".into());
                }
            }
            let encoded = serde_json::to_string(answers)
                .map_err(|error| format!("serialize Codex answers: {error}"))?;
            format!(
                "The user answered your async question (call_id: {call_id}). Answers by question title: {encoded}"
            )
        }
    };
    Ok(json!({
        "jsonrpc": "2.0",
        "id": rpc_id,
        "method": "turn/steer",
        "params": {
            "threadId": thread_id,
            "expectedTurnId": turn_id,
            "input": [{ "type": "text", "text": message }],
        },
    }))
}

pub(in crate::engines) fn next_async_question_rpc_id() -> String {
    format!(
        "ccgui-async-question-{}",
        NEXT_ASYNC_QUESTION_RPC_ID.fetch_add(1, Ordering::Relaxed)
    )
}

/// Build the CLI's response to a parked question.
///
/// `parked` is the context stored by `park_question`; `answers` is the raw
/// frontend map (question text → chosen label, or a list of labels for a
/// multi-select). `None` means the user dismissed the card — that must settle
/// the CLI's request with an empty answer so the model can carry on, never an
/// error. A mismatch between what the frontend answered and what the server
/// asked is an error instead: it means the card and the request drifted, and
/// silently dropping the answer would park the turn forever.
pub(in crate::engines) fn answer_frame(
    parked: &Value,
    answers: Option<&Value>,
) -> Result<Value, String> {
    let id = parked
        .get("rpcId")
        .ok_or_else(|| "parked question lost its rpc id".to_string())?;
    let ids = parked.get("ids").and_then(Value::as_object);
    let mut out = Map::new();
    if let Some(answers) = answers {
        let answers = answers
            .as_object()
            .ok_or_else(|| "codex answers must be an object".to_string())?;
        for (text, choice) in answers {
            let Some(question_id) = ids.and_then(|ids| ids.get(text)).and_then(Value::as_str)
            else {
                return Err(format!("codex did not ask a question titled {text:?}"));
            };
            // A single-select arrives as a bare label; the wire only has the
            // list form, so both are normalized into it.
            let labels = match choice {
                Value::String(label) => vec![Value::String(label.clone())],
                Value::Array(labels) => labels.clone(),
                Value::Null => Vec::new(),
                other => return Err(format!("unsupported codex answer for {text:?}: {other}")),
            };
            out.insert(question_id.to_string(), json!({ "answers": labels }));
        }
    }
    Ok(jsonrpc_result_response(id, json!({ "answers": out })))
}

/// Project the protocol's `questions` onto the app's card spec, building the
/// question-text → question-id map in the same pass so the two cannot drift:
/// the card the user picks is keyed by its text, while the response the CLI
/// needs is keyed by the server's own id.
pub(super) fn question_cards(params: &Value) -> (Vec<Value>, Value) {
    let mut cards = Vec::new();
    let mut ids = Map::new();
    let Some(questions) = params.get("questions").and_then(Value::as_array) else {
        return (cards, Value::Object(ids));
    };
    for (index, question) in questions.iter().enumerate() {
        let (Some(id), Some(text)) = (
            question.get("id").and_then(Value::as_str),
            question.get("question").and_then(Value::as_str),
        ) else {
            continue;
        };
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        // The card's header is a short chip and the protocol's is optional, so
        // a missing one falls back to the question's position.
        let header = question
            .get("header")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|header| !header.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("Q{}", index + 1));
        let options: Vec<Value> = question
            .get("options")
            .and_then(Value::as_array)
            .map(|options| {
                options
                    .iter()
                    .filter_map(|option| {
                        let label = option.get("label").and_then(Value::as_str)?;
                        let mut card = Map::new();
                        card.insert("label".to_string(), json!(label));
                        if let Some(description) = option
                            .get("description")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|description| !description.is_empty())
                        {
                            card.insert("description".to_string(), json!(description));
                        }
                        Some(Value::Object(card))
                    })
                    .collect()
            })
            .unwrap_or_default();
        // `multiSelect` is omitted: codex questions are single-choice, and an
        // absent flag is what the card already reads as. `isOther`/`isSecret`
        // have no place in the card spec.
        cards.push(json!({ "question": text, "header": header, "options": options }));
        ids.insert(text.to_string(), json!(id));
    }
    (cards, Value::Object(ids))
}
