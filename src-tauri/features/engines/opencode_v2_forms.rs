//! OpenCode 2.x forms: a form the session waits on as an answer card, and the answer back.

use reqwest::Method;
use serde_json::{json, Value};

use super::{call, EngineEvent, TurnCore, TurnState};

/// Parks a form the session is waiting on (the `question` tool's, or an MCP server's ask) as an
/// answer card, with what the answer needs to go back.
pub(super) fn park_form(
    core: &TurnCore,
    state: &mut TurnState,
    form: &Value,
    origin: &str,
    directory: &str,
) {
    let form_id = form
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let questions = render_form(form);
    if form_id.is_empty() || questions.is_empty() {
        return;
    }
    core.dispatch_event(
        state,
        EngineEvent::Question {
            request_id: form_id.clone(),
            tool_use_id: None,
            input: json!({ "questions": questions }),
        },
    );
    if let Some(entry) = core.registry.get(&core.run_id) {
        if let Ok(mut parked) = entry.questions.lock() {
            parked.insert(
                form_id.clone(),
                json!({
                    "opencode": {
                        "origin": origin,
                        "directory": directory,
                        "requestId": form_id,
                        "sessionId": form.get("sessionID").cloned().unwrap_or(Value::Null),
                        "form": form,
                    }
                }),
            );
        }
    }
}

/// The fields a card can answer: text (with or without choices), several choices, yes or no,
/// and numbers as text. Hidden fields and links to open elsewhere aren't asked.
fn askable(field: &Value) -> bool {
    let kind = field.get("type").and_then(Value::as_str).unwrap_or("");
    field.get("hidden").and_then(Value::as_bool) != Some(true)
        && matches!(
            kind,
            "string" | "multiselect" | "boolean" | "number" | "integer"
        )
}

/// A form's fields as the card's questions. The question tool puts its header in `title` and
/// the question in `description`; each option's label is its value.
pub(crate) fn render_form(form: &Value) -> Vec<Value> {
    form.get("fields")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|field| askable(field))
        .map(|field| {
            let title = field.get("title").and_then(Value::as_str);
            let question = field
                .get("description")
                .and_then(Value::as_str)
                .or(title)
                .or_else(|| field.get("key").and_then(Value::as_str))
                .unwrap_or("");
            let kind = field.get("type").and_then(Value::as_str).unwrap_or("");
            let options = if kind == "boolean" {
                json!([{ "label": "Yes" }, { "label": "No" }])
            } else {
                let options: Vec<Value> = field
                    .get("options")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .map(|option| {
                        let label = option
                            .get("label")
                            .or_else(|| option.get("value"))
                            .cloned()
                            .unwrap_or(Value::Null);
                        let mut out = json!({ "label": label });
                        if let Some(description) = option.get("description") {
                            out["description"] = description.clone();
                        }
                        out
                    })
                    .collect();
                json!(options)
            };
            json!({
                "question": question,
                "header": title.unwrap_or("Question"),
                "multiSelect": kind == "multiselect",
                "options": options,
            })
        })
        .collect()
}

/// The form reply's `answer` from the card's answers (rendered question → label(s) or text): each
/// field's key with a value of its type. A chosen label goes back as its option's value; text
/// that matches no option goes as typed (the question tool takes free text).
pub(crate) fn form_answer(form: &Value, answers: &Value) -> Option<Value> {
    let map = answers.as_object()?;
    let fields: Vec<&Value> = form
        .get("fields")
        .and_then(Value::as_array)?
        .iter()
        .filter(|field| askable(field))
        .collect();
    let rendered = render_form(form);
    let mut answer = serde_json::Map::new();
    for (field, card) in fields.iter().zip(&rendered) {
        let (Some(key), Some(question)) = (
            field.get("key").and_then(Value::as_str),
            card.get("question").and_then(Value::as_str),
        ) else {
            continue;
        };
        let picked: Vec<String> = match map.get(question) {
            Some(Value::Array(labels)) => labels
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect(),
            Some(Value::String(text)) if !text.is_empty() => vec![text.clone()],
            _ => continue,
        };
        let value_of = |label: &str| -> String {
            field
                .get("options")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .find(|option| option.get("label").and_then(Value::as_str) == Some(label))
                .and_then(|option| option.get("value").and_then(Value::as_str))
                .unwrap_or(label)
                .to_string()
        };
        let value = match field.get("type").and_then(Value::as_str).unwrap_or("") {
            "multiselect" => json!(picked.iter().map(|l| value_of(l)).collect::<Vec<_>>()),
            "boolean" => json!(picked[0].eq_ignore_ascii_case("yes")),
            "number" | "integer" => picked[0]
                .trim()
                .parse::<f64>()
                .map(|n| json!(n))
                .unwrap_or_else(|_| json!(picked[0])),
            _ => json!(value_of(&picked[0])),
        };
        answer.insert(key.to_string(), value);
    }
    Some(Value::Object(answer))
}

/// Answers a parked form: the card's answers as the reply, or dismissed as a cancel (the question
/// tool tells the model the person dismissed it).
pub(crate) async fn answer_form(context: &Value, answers: Option<&Value>) -> Result<(), String> {
    let text = |key: &str| context.get(key).and_then(Value::as_str);
    let origin = text("origin").ok_or("question answer context is missing the server origin")?;
    let form_id = text("requestId").ok_or("question answer context is missing the form id")?;
    let session_id = text("sessionId").ok_or("question answer context is missing the session")?;
    let path = format!("/api/session/{session_id}/form/{form_id}");
    match answers {
        None => call(Method::DELETE, origin, &path, None, None)
            .await
            .map(|_| ()),
        Some(answers) => {
            let form = context.get("form").cloned().unwrap_or(Value::Null);
            let answer =
                form_answer(&form, answers).ok_or("question answer context is malformed")?;
            call(
                Method::POST,
                origin,
                &format!("{path}/reply"),
                None,
                Some(json!({ "answer": answer })),
            )
            .await
            .map(|_| ())
        }
    }
}
