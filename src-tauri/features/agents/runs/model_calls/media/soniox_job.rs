//! What a Soniox job is asked to do and what its tokens say.
use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use super::transcription::TranscriptSegment;
use crate::model_calls::prompt::ProviderOptions;

/// A token with only the fields the provider's schema names, if it has its text.
pub(super) fn picked_token(token: &Value) -> Option<Value> {
    token.get("text")?.as_str()?;
    let mut kept = Map::new();
    for key in ["text", "start_ms", "end_ms", "confidence", "speaker", "language", "translation_status"] {
        if let Some(field) = token.get(key) {
            kept.insert(key.to_owned(), field.clone());
        }
    }
    Some(Value::Object(kept))
}

pub(super) fn segment(token: &Value) -> Option<TranscriptSegment> {
    Some(TranscriptSegment {
        text: token.get("text")?.as_str()?.to_owned(),
        start_second: token.get("start_ms")?.as_f64()? / 1000.0,
        end_second: token.get("end_ms")?.as_f64()? / 1000.0,
    })
}

/// Soniox names its context fields in snake case.
fn mapped_context(context: &Value) -> Option<Value> {
    if context.is_null() || context.as_str() == Some("") {
        return None;
    }
    let Value::Object(fields) = context else {
        return Some(context.clone());
    };
    let mut mapped = Map::new();
    for (from, to) in [("general", "general"), ("text", "text"), ("terms", "terms"), ("translationTerms", "translation_terms")] {
        if let Some(value) = fields.get(from).filter(|value| !value.is_null()) {
            mapped.insert(to.to_owned(), value.clone());
        }
    }
    Some(Value::Object(mapped))
}

fn mapped_translation(translation: &Value) -> Option<Value> {
    match translation.get("type")?.as_str()? {
        "one_way" => Some(json!({ "type": "one_way", "target_language": translation.get("targetLanguage") })),
        _ => Some(json!({ "type": "two_way", "language_a": translation.get("languageA"), "language_b": translation.get("languageB") })),
    }
}

pub(super) fn job_body(model: &str, file_id: &str, options: Option<&ProviderOptions>) -> Map<String, Value> {
    let mut body = Map::new();
    body.insert("model".into(), json!(model));
    body.insert("file_id".into(), json!(file_id));
    let soniox = options.and_then(|all| all.get("soniox"));
    let read = |key: &str| soniox.and_then(|fields| fields.get(key)).filter(|value| !value.is_null());
    for (from, to) in [
        ("languageHints", "language_hints"),
        ("languageHintsStrict", "language_hints_strict"),
        ("enableLanguageIdentification", "enable_language_identification"),
        ("enableSpeakerDiarization", "enable_speaker_diarization"),
        ("clientReferenceId", "client_reference_id"),
        ("webhookUrl", "webhook_url"),
        ("webhookAuthHeaderName", "webhook_auth_header_name"),
        ("webhookAuthHeaderValue", "webhook_auth_header_value"),
    ] {
        if let Some(value) = read(from) {
            body.insert(to.to_owned(), value.clone());
        }
    }
    if let Some(context) = read("context").and_then(mapped_context) {
        body.insert("context".into(), context);
    }
    if let Some(translation) = read("translation").and_then(mapped_translation) {
        body.insert("translation".into(), translation);
    }
    body
}

/// The language most tokens are in. The first to reach the highest count wins a tie.
pub(super) fn language_from_tokens(tokens: &[Value]) -> Option<String> {
    let mut order: Vec<&str> = Vec::new();
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for language in tokens.iter().filter_map(|token| token.get("language")?.as_str()).filter(|text| !text.is_empty()) {
        if !counts.contains_key(language) {
            order.push(language);
        }
        *counts.entry(language).or_default() += 1;
    }
    let mut best: Option<(&str, usize)> = None;
    for language in order {
        let count = counts[language];
        if best.map_or(true, |(_, top)| count > top) {
            best = Some((language, count));
        }
    }
    best.map(|(language, _)| language.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(language: Option<&str>) -> Value {
        json!({ "text": "a", "language": language })
    }

    #[test]
    fn tokens_keep_only_known_fields_and_need_text() {
        assert_eq!(
            picked_token(&json!({ "text": "a", "speaker": 1, "start_ms": 5, "extra": true, "language": null })).unwrap(),
            json!({ "text": "a", "speaker": 1, "start_ms": 5, "language": null }),
        );
        assert!(picked_token(&json!({ "speaker": 1 })).is_none());
        assert_eq!(segment(&json!({ "text": "a", "start_ms": 500, "end_ms": 1500 })).unwrap().end_second, 1.5);
        assert!(segment(&json!({ "text": "a", "start_ms": 500 })).is_none());
    }

    #[test]
    fn the_most_common_language_wins_and_the_first_breaks_a_tie() {
        let tokens = [token(Some("en")), token(Some("de")), token(Some("de")), token(None)];
        assert_eq!(language_from_tokens(&tokens).as_deref(), Some("de"));
        let tie = [token(Some("fr")), token(Some("en"))];
        assert_eq!(language_from_tokens(&tie).as_deref(), Some("fr"));
        assert_eq!(language_from_tokens(&[token(None)]), None);
    }

    #[test]
    fn job_options_are_renamed_for_soniox() {
        let options: ProviderOptions = serde_json::from_value(json!({
            "soniox": {
                "enableSpeakerDiarization": true,
                "enableLanguageIdentification": true,
                "languageHints": ["en"],
                "context": { "text": "A talk.", "terms": ["Misty"], "translationTerms": [{ "source": "a", "target": "b" }] },
                "translation": { "type": "one_way", "targetLanguage": "de" },
            }
        }))
        .unwrap();
        assert_eq!(
            Value::Object(job_body("stt", "file-1", Some(&options))),
            json!({
                "model": "stt",
                "file_id": "file-1",
                "enable_speaker_diarization": true,
                "enable_language_identification": true,
                "language_hints": ["en"],
                "context": { "text": "A talk.", "terms": ["Misty"], "translation_terms": [{ "source": "a", "target": "b" }] },
                "translation": { "type": "one_way", "target_language": "de" },
            })
        );
    }
}
