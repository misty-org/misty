//! The narrow request ChatGPT plan usage accepts. Ported from `chatgptBody` in
//! `chatgpt-provider.ts`. Key order is kept, because a body with its keys sorted would break prompt
//! caching just as it would anywhere else.
use crate::sdk::providers::{ordered::Ordered, ordered_ext::OrderedExt};

const FORBIDDEN: [&str; 17] = [
    "background",
    "conversation",
    "max_output_tokens",
    "max_tool_calls",
    "metadata",
    "moderation",
    "multi_agent",
    "prompt",
    "prompt_cache_retention",
    "safety_identifier",
    "temperature",
    "top_logprobs",
    "top_p",
    "truncation",
    "user",
    "previous_response_id",
    "service_tier",
];

/// `itemText`: a system item's words, however they're held.
fn item_text(content: Option<&Ordered>) -> String {
    match content {
        Some(Ordered::String(text)) => text.clone(),
        Some(Ordered::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Ordered::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn is_system_item(item: &Ordered) -> bool {
    item.get("role").and_then(Ordered::as_str) == Some("system")
        && match item.get("type") {
            None => true,
            Some(kind) => kind.as_str() == Some("message"),
        }
}

/// The body the preview accepts, from the body the Responses client built.
pub(crate) fn chatgpt_body(mut body: Ordered) -> Ordered {
    for field in FORBIDDEN {
        body.take(field);
    }
    let mut system: Vec<String> = Vec::new();
    let mut kept = Vec::new();
    if let Some(Ordered::Array(items)) = body.get("input") {
        for item in items {
            if is_system_item(item) {
                let text = item_text(item.get("content"));
                let text = text.trim();
                if !text.is_empty() {
                    system.push(text.to_owned());
                }
            } else {
                kept.push(item.clone());
            }
        }
    }
    let own = body.get("instructions").and_then(Ordered::as_str).map(str::trim).unwrap_or("").to_owned();
    let mut pieces = Vec::with_capacity(system.len() + 1);
    if !own.is_empty() {
        pieces.push(own);
    }
    pieces.extend(system);
    body.put("input", Ordered::Array(kept));
    if pieces.is_empty() {
        body.take("instructions");
    } else {
        body.put("instructions", Ordered::text(pieces.join("\n\n")));
    }
    body.put("store", Ordered::Bool(false));
    body.put("stream", Ordered::Bool(true));
    body
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;

    /// What the preview refuses (developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
    const REFUSED: [&str; 16] = [
        "background",
        "conversation",
        "max_output_tokens",
        "max_tool_calls",
        "metadata",
        "moderation",
        "multi_agent",
        "prompt",
        "prompt_cache_retention",
        "safety_identifier",
        "temperature",
        "top_logprobs",
        "top_p",
        "truncation",
        "user",
        "previous_response_id",
    ];

    fn shaped(value: Value) -> Value {
        chatgpt_body(Ordered::from_text(&value.to_string()).unwrap()).to_value()
    }

    #[test]
    fn drops_every_refused_field_and_moves_system_text_into_instructions() {
        let mut body = json!({
            "model": "gpt-test",
            "input": [
                { "role": "system", "content": "Be brief." },
                { "role": "developer", "content": "Developer note." },
                { "role": "user", "content": [{ "type": "input_text", "text": "hi" }] },
            ],
            "instructions": "Misty.",
            "store": true,
        });
        for field in REFUSED {
            body[field] = json!(1);
        }
        let shaped = shaped(body);
        for field in REFUSED {
            assert!(shaped.get(field).is_none(), "{field}");
        }
        assert_eq!(shaped["store"], json!(false));
        assert_eq!(shaped["stream"], json!(true));
        assert_eq!(shaped["instructions"], json!("Misty.\n\nBe brief."));
        assert_eq!(
            shaped["input"],
            json!([
                { "role": "developer", "content": "Developer note." },
                { "role": "user", "content": [{ "type": "input_text", "text": "hi" }] },
            ])
        );
    }

    #[test]
    fn system_text_comes_out_of_parts_and_only_message_items_count() {
        let shaped = shaped(json!({
            "input": [
                { "type": "message", "role": "system", "content": [{ "type": "input_text", "text": " One. " }, { "type": "input_text", "text": "Two." }] },
                { "role": "system", "content": "   " },
                { "type": "other", "role": "system", "content": "Kept." },
            ],
        }));
        assert_eq!(shaped["instructions"], json!("One. \nTwo."));
        assert_eq!(shaped["input"], json!([{ "type": "other", "role": "system", "content": "Kept." }]));
    }

    #[test]
    fn empty_instructions_are_removed_and_a_missing_input_is_empty() {
        let shaped = shaped(json!({ "instructions": "  " }));
        assert!(shaped.get("instructions").is_none());
        assert_eq!(shaped["input"], json!([]));
    }

    #[test]
    fn key_order_is_kept() {
        let shaped = chatgpt_body(
            Ordered::from_text(r#"{"model":"m","temperature":1,"tools":[{"parameters":{"z":1,"a":2}}],"input":[],"store":true}"#).unwrap(),
        );
        assert_eq!(
            shaped.to_text(),
            r#"{"model":"m","tools":[{"parameters":{"z":1,"a":2}}],"input":[],"store":false,"stream":true}"#
        );
    }
}
