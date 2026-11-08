//! Reading one generate-content chunk: its schema, and the fields each part of it keeps.
use serde_json::{json, Map, Value};

use crate::model_calls::stream::{InputTokens, OutputTokens, Usage};

pub(super) const GROUNDING_FIELDS: [&str; 7] = [
    "webSearchQueries",
    "imageSearchQueries",
    "retrievalQueries",
    "searchEntryPoint",
    "groundingChunks",
    "groundingSupports",
    "retrievalMetadata",
];

pub(super) fn google_metadata(payload: Value) -> Value {
    json!({ "google": payload })
}

pub(super) fn signature_metadata(part: &Value) -> Option<Value> {
    let signature = part.get("thoughtSignature")?.as_str().filter(|text| !text.is_empty())?;
    Some(google_metadata(json!({ "thoughtSignature": signature })))
}

pub(super) fn mapped_reason(reason: &str, has_tool_calls: bool) -> &'static str {
    match reason {
        "STOP" if has_tool_calls => "tool-calls",
        "STOP" => "stop",
        "MAX_TOKENS" => "length",
        "IMAGE_SAFETY" | "RECITATION" | "SAFETY" | "BLOCKLIST" | "PROHIBITED_CONTENT" | "SPII" => "content-filter",
        "MALFORMED_FUNCTION_CALL" => "error",
        _ => "other",
    }
}

/// Copies the fields a schema names, as parsing with it does: anything else is dropped.
pub(super) fn pick(value: &Value, keys: &[&str]) -> Value {
    let Some(fields) = value.as_object() else {
        return value.clone();
    };
    let mut kept = Map::new();
    for key in keys {
        if let Some(field) = fields.get(*key) {
            kept.insert((*key).to_owned(), field.clone());
        }
    }
    Value::Object(kept)
}

pub(super) fn picked_usage(usage: &Value) -> Value {
    pick(
        usage,
        &[
            "cachedContentTokenCount",
            "thoughtsTokenCount",
            "promptTokenCount",
            "candidatesTokenCount",
            "totalTokenCount",
            "trafficType",
            "serviceTier",
            "promptTokensDetails",
            "candidatesTokensDetails",
        ],
    )
}

pub(super) fn picked_ratings(ratings: &Value) -> Value {
    let keys = ["category", "probability", "probabilityScore", "severity", "severityScore", "blocked"];
    match ratings.as_array() {
        Some(list) => Value::Array(list.iter().map(|rating| pick(rating, &keys)).collect()),
        None => ratings.clone(),
    }
}

pub(super) fn picked_feedback(feedback: &Value) -> Value {
    let mut kept = pick(feedback, &["blockReason", "safetyRatings"]);
    if let Some(ratings) = kept.get("safetyRatings").map(picked_ratings) {
        kept["safetyRatings"] = ratings;
    }
    kept
}

pub(super) fn converted_usage(usage: Option<&Value>) -> Usage {
    let Some(usage) = usage else {
        return Usage::default();
    };
    let count = |name: &str| usage.get(name).and_then(Value::as_u64).unwrap_or(0);
    let prompt = count("promptTokenCount");
    let candidates = count("candidatesTokenCount");
    let cached = count("cachedContentTokenCount");
    let thoughts = count("thoughtsTokenCount");
    Usage {
        input_tokens: InputTokens {
            total: Some(prompt),
            no_cache: Some(prompt.saturating_sub(cached)),
            cache_read: Some(cached),
            cache_write: None,
        },
        output_tokens: OutputTokens {
            total: Some(candidates + thoughts),
            text: Some(candidates),
            reasoning: Some(thoughts),
        },
        raw: Some(usage.clone()),
    }
}

fn nullish(value: Option<&Value>, fits: fn(&Value) -> bool) -> bool {
    value.map_or(true, |value| value.is_null() || fits(value))
}

fn usage_fits(usage: &Value) -> bool {
    usage.is_object()
        && [
            "cachedContentTokenCount",
            "thoughtsTokenCount",
            "promptTokenCount",
            "candidatesTokenCount",
            "totalTokenCount",
        ]
        .iter()
        .all(|key| nullish(usage.get(*key), Value::is_number))
}

fn candidate_fits(candidate: &Value) -> bool {
    candidate.is_object()
        && nullish(candidate.get("finishReason"), Value::is_string)
        && nullish(candidate.get("finishMessage"), Value::is_string)
        && nullish(candidate.get("safetyRatings"), Value::is_array)
        && nullish(candidate.get("content"), |content| {
            content.is_object()
                && nullish(content.get("parts"), |parts| {
                    parts.as_array().is_some_and(|parts| parts.iter().all(Value::is_object))
                })
        })
}

/// The chunk schema's main shape. A chunk that doesn't fit is a failure the stream reports.
pub(super) fn valid_chunk(chunk: &Value) -> bool {
    chunk.is_object()
        && nullish(chunk.get("candidates"), |candidates| {
            candidates.as_array().is_some_and(|list| list.iter().all(candidate_fits))
        })
        && nullish(chunk.get("responseId"), Value::is_string)
        && nullish(chunk.get("usageMetadata"), usage_fits)
        && nullish(chunk.get("promptFeedback"), Value::is_object)
}
