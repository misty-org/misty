//! Soniox's realtime config and the captions its tokens become (`live/soniox.ts`).
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SonioxToken {
    pub text: String,
    pub is_final: bool,
    pub translation_status: Option<String>,
    pub start_ms: Option<f64>,
    pub end_ms: Option<f64>,
    pub speaker: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SonioxResult {
    pub tokens: Vec<SonioxToken>,
    pub total_audio_proc_ms: f64,
}

/// One message from Soniox, as `parseResultMessage` reads it.
pub(crate) struct ParsedMessage {
    pub(crate) result: SonioxResult,
    pub(crate) has_endpoint: bool,
    pub(crate) finished: bool,
}

/// `Boolean(value)`.
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(value)) => *value,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|number| number != 0.0),
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}

/// `None` for an error from the provider or a message that can't be read, both of which fail the
/// stream. What the failure said goes no further, since provider errors can echo request details.
pub(crate) fn parse_message(text: &str) -> Option<ParsedMessage> {
    let raw: Value = serde_json::from_str(text).ok()?;
    let fields = raw.as_object()?;
    if fields.contains_key("error_code") || fields.contains_key("error_message") {
        return None;
    }
    let tokens = match fields.get("tokens") {
        None | Some(Value::Null) => &[][..],
        Some(tokens) => tokens.as_array()?,
    };
    let tokens: Vec<SonioxToken> = tokens
        .iter()
        .map(|token| SonioxToken {
            text: token.get("text").and_then(Value::as_str).unwrap_or("").to_owned(),
            is_final: truthy(token.get("is_final")),
            translation_status: token
                .get("translation_status")
                .and_then(Value::as_str)
                .filter(|status| matches!(*status, "none" | "original" | "translation"))
                .map(str::to_owned),
            start_ms: token.get("start_ms").and_then(Value::as_f64),
            end_ms: token.get("end_ms").and_then(Value::as_f64),
            speaker: token.get("speaker").and_then(Value::as_str).map(str::to_owned),
        })
        .collect();
    Some(ParsedMessage {
        has_endpoint: tokens.iter().any(|token| token.text == "<end>"),
        finished: fields.get("finished") == Some(&Value::Bool(true)),
        result: SonioxResult {
            tokens,
            total_audio_proc_ms: fields.get("total_audio_proc_ms").and_then(Value::as_f64).unwrap_or(0.0),
        },
    })
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct GeneralContext {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TranslationTerm {
    pub source: String,
    pub target: String,
}

/// Soniox's own context shape: general key/values, free text and terms.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct SonioxContext {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub terms: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub general: Vec<GeneralContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub translation_terms: Vec<TranslationTerm>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SonioxTranslation {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub target_language: String,
}

/// The first message on the socket, with the fields in the order `buildConfigMessage` writes them.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SonioxConfig {
    pub model: String,
    pub audio_format: &'static str,
    pub sample_rate: u32,
    pub num_channels: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language_hints: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_speaker_diarization: Option<bool>,
    pub enable_language_identification: bool,
    pub enable_endpoint_detection: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<SonioxContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translation: Option<SonioxTranslation>,
}

fn soniox_language(language: &str) -> &str {
    match language {
        "cmn" | "zh-cn" | "zh-tw" | "zh-hk" => "zh",
        "nb" | "nn" => "no",
        "fil" => "tl",
        other => other,
    }
}

fn has_context(context: &SonioxContext) -> bool {
    !context.general.is_empty() || context.text.is_some() || !context.terms.is_empty() || !context.translation_terms.is_empty()
}

/// Realtime session config for 16 kHz mono PCM16, always diarized. Translation only when the
/// languages differ.
pub(crate) fn soniox_config(source: &str, target: &str, model: &str, context: Option<SonioxContext>) -> SonioxConfig {
    SonioxConfig {
        model: model.to_owned(),
        audio_format: "pcm_s16le",
        sample_rate: 16_000,
        num_channels: 1,
        language_hints: (source != "auto").then(|| vec![soniox_language(source).to_owned()]),
        enable_speaker_diarization: Some(true),
        enable_language_identification: true,
        enable_endpoint_detection: true,
        context: context.filter(has_context),
        translation: (source != target && target != "auto")
            .then(|| SonioxTranslation { kind: "one_way", target_language: soniox_language(target).to_owned() }),
    }
}
