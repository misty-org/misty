//! Who said what in a file or a finished capture (`transcribe-diarized.ts`).
use serde_json::{json, Map, Value};

use super::super::{
    js_json::{number_text, JsValue},
    js_regex::js_regex,
    text::{js_is_space, js_trim},
};
use super::{
    failure::CallError,
    zod::{array, checked, node_base64, number_value, object, optional, string},
    DeviceCalls,
};
use crate::model_calls::{resolve_transcription_model, transcribe, ModelRoute, ProviderOptions};

#[derive(Debug, PartialEq)]
struct SpeakerTurn {
    speaker: String,
    language: Option<String>,
    start: f64,
    end: f64,
    text: String,
}

impl SpeakerTurn {
    fn to_value(&self) -> Value {
        let mut fields = Map::new();
        fields.insert("speaker".to_owned(), json!(self.speaker));
        if let Some(language) = &self.language {
            fields.insert("language".to_owned(), json!(language));
        }
        fields.insert("start".to_owned(), number_value(self.start));
        fields.insert("end".to_owned(), number_value(self.end));
        fields.insert("text".to_owned(), json!(self.text));
        Value::Object(fields)
    }
}

/// `String(token.speaker)`, with no speaker reading as `?`.
fn speaker_of(token: &Value) -> String {
    match token.get("speaker") {
        None | Some(Value::Null) => "?".to_owned(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => number.as_f64().map_or_else(|| number.to_string(), number_text),
        Some(other) => other.to_string(),
    }
}

/// Groups Soniox tokens into consecutive speaker turns.
fn speaker_turns(tokens: &[Value]) -> Vec<SpeakerTurn> {
    let mut turns: Vec<SpeakerTurn> = Vec::new();
    for token in tokens {
        let text = token.get("text").and_then(Value::as_str).unwrap_or("");
        let translated = token.get("translation_status").and_then(Value::as_str) == Some("translation");
        if text.is_empty() || translated || text == "<end>" || text == "<fin>" {
            continue;
        }
        let speaker = speaker_of(token);
        let milliseconds = |key: &str| token.get(key).and_then(Value::as_f64);
        let start = milliseconds("start_ms").unwrap_or(0.0) / 1000.0;
        let end = milliseconds("end_ms").or(milliseconds("start_ms")).unwrap_or(0.0) / 1000.0;
        match turns.last_mut() {
            Some(last) if last.speaker == speaker => {
                last.text.push_str(text);
                last.end = last.end.max(end);
            }
            _ => turns.push(SpeakerTurn {
                speaker,
                language: token.get("language").and_then(Value::as_str).filter(|language| !language.is_empty()).map(str::to_owned),
                start,
                end,
                text: text.trim_start_matches(js_is_space).to_owned(),
            }),
        }
    }
    for turn in &mut turns {
        turn.text = js_trim(&turn.text).to_owned();
    }
    turns.retain(|turn| !turn.text.is_empty());
    turns
}

/// A file or finished capture, transcribed with speaker labels.
pub(super) async fn transcribe_diarized_call(calls: &DeviceCalls, model: &str, route: &ModelRoute, body: &JsValue) -> Result<Value, CallError> {
    let (audio, languages, context) = checked(|| {
        let request = object(body)?;
        js_regex(r"^(audio|video)\/[\w.+-]+$", false).is_match(request.get("mediaType")?.as_str()?).then_some(())?;
        let audio = request.get("audio")?.as_str().filter(|audio| !audio.is_empty())?;
        let languages = optional(request.get("languages"), |value| {
            array(value, 0, 10)?.iter().map(|language| string(Some(language), 16)).collect::<Option<Vec<_>>>()
        })?;
        let context = optional(request.get("context"), |value| {
            let context = object(value?)?;
            let mut kept = Map::new();
            if let Some(text) = optional(context.get("text"), |value| string(value, 10_000))? {
                kept.insert("text".to_owned(), json!(text));
            }
            let terms = optional(context.get("terms"), |value| {
                array(value, 0, 200)?.iter().map(|term| string(Some(term), 160)).collect::<Option<Vec<_>>>()
            })?;
            if let Some(terms) = terms {
                kept.insert("terms".to_owned(), json!(terms));
            }
            Some(Value::Object(kept))
        })?;
        Some((audio, languages, context))
    })?;
    let resolved = resolve_transcription_model(model, route, &calls.client)?;
    let mut soniox = Map::new();
    soniox.insert("enableSpeakerDiarization".to_owned(), json!(true));
    soniox.insert("enableLanguageIdentification".to_owned(), json!(true));
    if let Some(languages) = languages.filter(|languages| !languages.is_empty()) {
        soniox.insert("languageHints".to_owned(), json!(languages));
    }
    if let Some(context) = context {
        soniox.insert("context".to_owned(), context);
    }
    let mut options = ProviderOptions::new();
    options.insert("soniox".to_owned(), Value::Object(soniox));
    let result = transcribe(resolved.as_ref(), &node_base64(audio), Some(&options), Some(1)).await?;
    let tokens = result.provider_metadata.as_ref().and_then(|metadata| metadata.get("soniox")?.get("tokens")?.as_array());
    let turns = speaker_turns(tokens.map_or(&[], Vec::as_slice));
    Ok(json!({
        "text": result.text,
        "language": result.language.as_deref().unwrap_or(""),
        "durationInSeconds": result.duration_in_seconds.map_or(Value::Null, number_value),
        "turns": turns.iter().map(SpeakerTurn::to_value).collect::<Vec<_>>(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_a_two_speaker_transcript_into_turns_and_drops_translations() {
        let fixture: Value =
            serde_json::from_str(include_str!("../tests/fixtures/runtime_device/soniox-async-two-speakers.json")).unwrap();
        let turns = speaker_turns(fixture["tokens"].as_array().unwrap());
        let values: Vec<Value> = turns.iter().map(SpeakerTurn::to_value).collect();
        assert_eq!(
            values,
            vec![
                json!({ "speaker": "1", "language": "en", "start": 0, "end": 0.9, "text": "Morning everyone." }),
                json!({ "speaker": "2", "language": "en", "start": 1.1, "end": 1.7, "text": "Hi Dana." }),
                json!({ "speaker": "1", "language": "en", "start": 1.9, "end": 2.5, "text": "Let's start." }),
            ]
        );
    }

    #[test]
    fn a_missing_speaker_reads_as_unknown() {
        let turns = speaker_turns(&[json!({ "text": " hi", "start_ms": 1000 }), json!({ "text": "  ", "speaker": 3 })]);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].speaker, "?");
        assert_eq!(turns[0].text, "hi");
        assert_eq!(turns[0].end, 1.0);
    }
}
