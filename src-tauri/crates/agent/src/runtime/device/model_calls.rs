//! The building blocks the desktop's calls and its voice share (`model-calls.ts`). Each runs on the
//! device's key for the model's provider. The route stays in memory for one call.
use std::time::Duration;

use serde_json::{json, Map, Value};

use super::super::js_regex::js_regex;
use super::{failure::CallError, zod::number_value};
use crate::sdk::{
    embed_many, generate_speech, generate_text, resolve_embedding_model, resolve_model, CallOptions, GenerateResult,
    GenerateSettings, Message, ModelError, ModelRoute, OutputObject, ProviderOptions, SpeechModel, SpeechRequest,
    UserPart,
};

/// `RoutedModel` and `generateText` with the one retry every call here has.
pub(crate) async fn routed_generate(
    client: &reqwest::Client,
    model_id: &str,
    route: &ModelRoute,
    options: CallOptions,
    output: Option<OutputObject>,
) -> Result<GenerateResult, ModelError> {
    let (model, options) = resolve_model(model_id, options, route, client)?;
    generate_text(model.as_ref(), options, GenerateSettings { max_retries: Some(1), output }).await
}

/// `AbortSignal.timeout(ms)` over a whole call, retries included.
pub(crate) async fn limited<T, E: Into<CallError>>(ms: u64, call: impl std::future::Future<Output = Result<T, E>>) -> Result<T, CallError> {
    match tokio::time::timeout(Duration::from_millis(ms), call).await {
        Ok(result) => result.map_err(Into::into),
        Err(_) => Err(CallError::TimedOut),
    }
}

/// `{ role: "user", content: text }`, as the SDK hands it to a model.
pub(crate) fn user_text(text: &str) -> Message {
    Message::User { content: vec![UserPart::Text { text: text.to_owned() }], provider_options: None }
}

/// A call's prompt: `system` first when there is one.
pub(crate) fn asking(system: Option<&str>, messages: Vec<Message>, max_output_tokens: u32) -> CallOptions {
    let mut prompt = Vec::with_capacity(messages.len() + 1);
    if let Some(system) = system {
        prompt.push(Message::System { content: system.to_owned(), provider_options: None });
    }
    prompt.extend(messages);
    CallOptions { prompt, max_output_tokens: Some(max_output_tokens), ..CallOptions::default() }
}

/// `/^[^\s/]+\/\S+$/` with a length, the shape of a model ID in a call.
fn valid_model_id(model: &str) -> bool {
    (3..=200).contains(&model.len()) && js_regex(r"^[^\s/]+\/\S+$", false).is_match(model)
}

/// A value's image, for models that embed pictures.
pub struct EmbedImage {
    pub media_type: String,
    /// Base64.
    pub data: String,
}

pub struct EmbedCall<'a> {
    pub route: &'a ModelRoute,
    pub model: &'a str,
    pub values: &'a [String],
    pub dimensions: Option<u32>,
    pub images: Option<&'a [Option<EmbedImage>]>,
}

const MAX_EMBED_VALUE: usize = 256 << 10;

/// `embedCall`.
pub async fn embed_call(client: &reqwest::Client, call: EmbedCall<'_>) -> Result<Vec<Vec<f64>>, CallError> {
    let valid_values = (1..=100).contains(&call.values.len())
        && call.values.iter().all(|value| super::super::text::js_len(value) <= MAX_EMBED_VALUE);
    let valid_dimensions = call.dimensions.map_or(true, |dimensions| (1..=4096).contains(&dimensions));
    let valid_images = call.images.map_or(true, |images| {
        images.iter().flatten().all(|image| {
            matches!(image.media_type.as_str(), "image/jpeg" | "image/png" | "image/webp")
                && image.data.len() <= 24 << 20
                && super::zod::is_base64_text(&image.data)
        })
    });
    if !valid_model_id(call.model) || !valid_values || !valid_dimensions || !valid_images {
        return Err(CallError::invalid());
    }
    if call.images.is_some_and(|images| images.len() != call.values.len()) {
        return Err(CallError::call(400, "invalid_model_call", "Each image must match a value"));
    }
    let images = call.images.filter(|images| images.iter().any(Option::is_some));
    let mut options = ProviderOptions::new();
    if let Some(dimensions) = call.dimensions {
        // Each chat-completions provider reads its options under its own name.
        for name in ["openai", "openai-compatible", "openrouter", "nvidia", "ollama"] {
            options.insert(name.to_owned(), json!({ "dimensions": dimensions }));
        }
    }
    let mut google = Map::new();
    if let Some(dimensions) = call.dimensions {
        google.insert("outputDimensionality".to_owned(), json!(dimensions));
    }
    if let Some(images) = images {
        let content: Vec<Value> = images
            .iter()
            .map(|image| match image {
                Some(image) => json!([{ "inlineData": { "mimeType": image.media_type, "data": image.data } }]),
                None => Value::Null,
            })
            .collect();
        google.insert("content".to_owned(), Value::Array(content));
    }
    options.insert("google".to_owned(), Value::Object(google));
    let model = resolve_embedding_model(call.model, call.route, client)?;
    let result = embed_many(model.as_ref(), call.values, Some(&options), Some(1)).await?;
    Ok(result.embeddings)
}

/// Spoken replies for the voice pipeline.
pub struct SpeechCall<'a> {
    pub model: &'a str,
    pub text: &'a str,
    /// An OpenAI voice name or an ElevenLabs voice ID.
    pub voice: Option<&'a str>,
    /// A reply spoken sentence by sentence: its neighbours keep the delivery continuous across the
    /// joins (ElevenLabs only).
    pub previous_text: Option<&'a str>,
    pub next_text: Option<&'a str>,
}

/// `speechCall` on a model already resolved: raw 24 kHz 16-bit mono PCM, the format the voice
/// session streams to the app.
pub async fn speech_call(model: &dyn SpeechModel, call: SpeechCall<'_>) -> Result<Vec<u8>, CallError> {
    use super::super::text::js_len;
    let text_length = js_len(call.text);
    let valid_voice = call.voice.map_or(true, |voice| js_regex(r"^[A-Za-z0-9_-]{1,64}$", false).is_match(voice));
    let valid_neighbour = |text: Option<&str>| text.map_or(true, |text| js_len(text) <= 4000);
    if !valid_model_id(call.model)
        || !(1..=8000).contains(&text_length)
        || !valid_voice
        || !valid_neighbour(call.previous_text)
        || !valid_neighbour(call.next_text)
    {
        return Err(CallError::invalid());
    }
    let elevenlabs = call.model.starts_with("elevenlabs/");
    let filled = |text: Option<&str>| text.is_some_and(|text| !text.is_empty());
    let provider_options = (elevenlabs && (filled(call.previous_text) || filled(call.next_text))).then(|| {
        let mut neighbours = Map::new();
        if let Some(text) = call.previous_text {
            neighbours.insert("previousText".to_owned(), json!(text));
        }
        if let Some(text) = call.next_text {
            neighbours.insert("nextText".to_owned(), json!(text));
        }
        let mut options = ProviderOptions::new();
        options.insert("elevenlabs".to_owned(), Value::Object(neighbours));
        options
    });
    let request = SpeechRequest {
        text: call.text.to_owned(),
        // ElevenLabs picks its default voice when none is configured.
        voice: call.voice.map(str::to_owned).or_else(|| (!elevenlabs).then(|| "alloy".to_owned())),
        // OpenAI's "pcm" is 24 kHz; ElevenLabs needs the rate spelled out.
        output_format: Some(if elevenlabs { "pcm_24000" } else { "pcm" }.to_owned()),
        provider_options,
        ..SpeechRequest::default()
    };
    Ok(generate_speech(model, &request, Some(1)).await?.audio)
}

/// `result.usage` as the screen planner reports it.
pub(super) fn token_count(count: Option<u64>) -> Value {
    number_value(count.unwrap_or(0) as f64)
}
