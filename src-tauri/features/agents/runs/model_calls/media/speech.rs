//! Speech. `generate_speech` is ported from the `ai` package's `generateSpeech`, and the models from
//! `@ai-sdk/openai`, `@ai-sdk/elevenlabs` and `@ai-sdk/gateway`.
use std::sync::Arc;

use base64::Engine;
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use super::http::{openai_error_message, read_bytes, read_json};
use crate::model_calls::error::ModelError;
use crate::model_calls::generate::{with_retries, DEFAULT_MAX_RETRIES};
use crate::model_calls::http::{post_body, post_json};
use crate::model_calls::media_type::{detect_in_bytes, lenient_base64};
use crate::model_calls::prompt::ProviderOptions;
use crate::model_calls::providers::gateway::{self, auth_headers, checked};
use crate::model_calls::route::{resolve_target, ModelRoute, ProviderId};

const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
// The TypeScript runtime can't point ElevenLabs anywhere else either, so a base URL isn't read.
const ELEVENLABS_BASE_URL: &str = "https://api.elevenlabs.io";
const OPENAI_FORMATS: [&str; 6] = ["mp3", "opus", "aac", "flac", "wav", "pcm"];

#[derive(Clone, Debug, Default)]
pub struct SpeechRequest {
    pub text: String,
    pub voice: Option<String>,
    pub output_format: Option<String>,
    pub instructions: Option<String>,
    pub speed: Option<f64>,
    pub language: Option<String>,
    pub provider_options: Option<ProviderOptions>,
}

#[derive(Clone, Debug, Default)]
pub struct SpeechResponse {
    pub audio: Vec<u8>,
    pub warnings: Vec<Value>,
    pub provider_metadata: Option<Value>,
}

pub trait SpeechModel: Send + Sync {
    fn do_generate<'a>(&'a self, request: &'a SpeechRequest) -> BoxFuture<'a, Result<SpeechResponse, ModelError>>;
}

/// Spoken audio, with its type worked out from the bytes.
#[derive(Clone, Debug, Default)]
pub struct GeneratedSpeech {
    pub audio: Vec<u8>,
    pub media_type: String,
    pub format: String,
    pub warnings: Vec<Value>,
    pub provider_metadata: Option<Value>,
}

/// `max_retries` of `None` is the SDK's default of 2.
pub async fn generate_speech(
    model: &dyn SpeechModel,
    request: &SpeechRequest,
    max_retries: Option<u32>,
) -> Result<GeneratedSpeech, ModelError> {
    let result = with_retries(max_retries.unwrap_or(DEFAULT_MAX_RETRIES), || model.do_generate(request)).await?;
    if result.audio.is_empty() {
        return Err(ModelError::NoOutput {
            name: "AI_NoSpeechGeneratedError",
            message: "No speech audio generated.".into(),
        });
    }
    // Raw PCM has no signature, so it reads as this default too.
    let media_type = detect_in_bytes(&result.audio, "audio").unwrap_or("audio/mp3").to_owned();
    let format = match media_type.as_str() {
        "audio/mpeg" => "mp3".to_owned(),
        other => other.split('/').nth(1).unwrap_or("mp3").to_owned(),
    };
    Ok(GeneratedSpeech {
        audio: result.audio,
        media_type,
        format,
        warnings: result.warnings,
        provider_metadata: result.provider_metadata,
    })
}

struct OpenAiSpeechModel {
    client: reqwest::Client,
    url: String,
    api_key: String,
    model: String,
}

impl SpeechModel for OpenAiSpeechModel {
    fn do_generate<'a>(&'a self, request: &'a SpeechRequest) -> BoxFuture<'a, Result<SpeechResponse, ModelError>> {
        Box::pin(async move {
            let mut warnings = Vec::new();
            let format = request.output_format.as_deref().unwrap_or("mp3");
            let response_format = if format.is_empty() || OPENAI_FORMATS.contains(&format) {
                if format.is_empty() { "mp3" } else { format }
            } else {
                warnings.push(json!({
                    "type": "unsupported",
                    "feature": "outputFormat",
                    "details": format!("Unsupported output format: {format}. Using mp3 instead."),
                }));
                "mp3"
            };
            if let Some(language) = request.language.as_deref().filter(|language| !language.is_empty()) {
                warnings.push(json!({
                    "type": "unsupported",
                    "feature": "language",
                    "details": format!("OpenAI speech models do not support language selection. Language parameter \"{language}\" was ignored."),
                }));
            }
            let mut body = Map::new();
            body.insert("model".into(), json!(self.model));
            body.insert("input".into(), json!(request.text));
            body.insert("voice".into(), json!(request.voice.as_deref().unwrap_or("alloy")));
            body.insert("response_format".into(), json!(response_format));
            if let Some(speed) = request.speed {
                body.insert("speed".into(), json!(speed));
            }
            if let Some(instructions) = &request.instructions {
                body.insert("instructions".into(), json!(instructions));
            }
            let headers = [("authorization", format!("Bearer {}", self.api_key))];
            let response =
                post_json(&self.client, &self.url, &headers, &body, &self.api_key, openai_error_message).await?;
            Ok(SpeechResponse { audio: read_bytes(response).await?, warnings, provider_metadata: None })
        })
    }
}

struct ElevenLabsSpeechModel {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
}

/// `{ error: { message, code } }`, with both required.
fn elevenlabs_error_message(body: &Value) -> Option<String> {
    let error = body.get("error")?;
    error.get("code")?.as_f64()?;
    Some(error.get("message")?.as_str()?.to_owned())
}

fn elevenlabs_format(format: &str) -> &str {
    match format {
        "mp3" | "mp3_128" => "mp3_44100_128",
        "mp3_32" => "mp3_44100_32",
        "mp3_64" => "mp3_44100_64",
        "mp3_96" => "mp3_44100_96",
        "mp3_192" => "mp3_44100_192",
        "pcm" => "pcm_44100",
        "ulaw" => "ulaw_8000",
        other => other,
    }
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ElevenLabsOptions {
    previous_text: Option<String>,
    next_text: Option<String>,
}

impl SpeechModel for ElevenLabsSpeechModel {
    fn do_generate<'a>(&'a self, request: &'a SpeechRequest) -> BoxFuture<'a, Result<SpeechResponse, ModelError>> {
        Box::pin(async move {
            let options: ElevenLabsOptions = match request.provider_options.as_ref().and_then(|all| all.get("elevenlabs")).filter(|value| !value.is_null()) {
                Some(value) => serde_json::from_value(value.clone())
                    .map_err(|_| ModelError::Unsupported("invalid elevenlabs provider options".into()))?,
                None => ElevenLabsOptions::default(),
            };
            let mut warnings = Vec::new();
            let mut body = Map::new();
            body.insert("text".into(), json!(request.text));
            body.insert("model_id".into(), json!(self.model));
            if let Some(language) = request.language.as_deref().filter(|language| !language.is_empty()) {
                body.insert("language_code".into(), json!(language));
            }
            if let Some(text) = options.previous_text.filter(|text| !text.is_empty()) {
                body.insert("previous_text".into(), json!(text));
            }
            if let Some(text) = options.next_text.filter(|text| !text.is_empty()) {
                body.insert("next_text".into(), json!(text));
            }
            if let Some(speed) = request.speed {
                body.insert("voice_settings".into(), json!({ "speed": speed }));
            }
            if request.instructions.as_deref().is_some_and(|text| !text.is_empty()) {
                warnings.push(json!({
                    "type": "unsupported",
                    "feature": "instructions",
                    "details": "ElevenLabs speech models do not support instructions. Instructions parameter was ignored.",
                }));
            }
            let voice = request.voice.as_deref().unwrap_or("21m00Tcm4TlvDq8ikWAM");
            let format = elevenlabs_format(request.output_format.as_deref().unwrap_or("mp3_44100_128"));
            let url = format!("{}/v1/text-to-speech/{voice}?output_format={format}", self.base_url);
            let headers = [("xi-api-key", self.api_key.clone())];
            let response =
                post_json(&self.client, &url, &headers, &body, &self.api_key, elevenlabs_error_message).await?;
            Ok(SpeechResponse { audio: read_bytes(response).await?, warnings, provider_metadata: None })
        })
    }
}

#[derive(Deserialize)]
struct GatewaySpeech {
    audio: String,
    #[serde(default)]
    warnings: Vec<Value>,
    #[serde(default, rename = "providerMetadata")]
    provider_metadata: Option<Value>,
}

struct GatewaySpeechModel {
    client: reqwest::Client,
    url: String,
    api_key: String,
    model: String,
}

impl SpeechModel for GatewaySpeechModel {
    fn do_generate<'a>(&'a self, request: &'a SpeechRequest) -> BoxFuture<'a, Result<SpeechResponse, ModelError>> {
        Box::pin(async move {
            let mut body = Map::new();
            body.insert("text".into(), json!(request.text));
            let filled = |value: &Option<String>| value.clone().filter(|text| !text.is_empty());
            if let Some(voice) = filled(&request.voice) {
                body.insert("voice".into(), json!(voice));
            }
            if let Some(format) = filled(&request.output_format) {
                body.insert("outputFormat".into(), json!(format));
            }
            if let Some(instructions) = filled(&request.instructions) {
                body.insert("instructions".into(), json!(instructions));
            }
            if let Some(speed) = request.speed {
                body.insert("speed".into(), json!(speed));
            }
            if let Some(language) = filled(&request.language) {
                body.insert("language".into(), json!(language));
            }
            // The SDK always passes provider options here, even when there are none.
            body.insert(
                "providerOptions".into(),
                Value::Object(request.provider_options.clone().unwrap_or_default()),
            );
            let bytes = serde_json::to_vec(&body)
                .map_err(|error| ModelError::Unsupported(format!("The request couldn't be built: {error}")))?;
            let mut headers = auth_headers(&self.api_key);
            headers.push(("ai-speech-model-specification-version", "4".to_owned()));
            headers.push(("ai-model-id", self.model.clone()));
            let response = post_body(&self.client, &self.url, &headers, "application/json", bytes, &self.api_key).await?;
            let response = checked(response, &self.api_key).await?;
            let parsed: GatewaySpeech = read_json(response).await?;
            let audio = lenient_base64().decode(&parsed.audio).map_err(|_| ModelError::Api {
                status: 200,
                message: "Invalid JSON response".into(),
                retryable: false,
                retry_after_ms: None,
            })?;
            Ok(SpeechResponse { audio, warnings: parsed.warnings, provider_metadata: parsed.provider_metadata })
        })
    }
}

pub(crate) fn elevenlabs_speech_model(client: reqwest::Client, base_url: &str, api_key: &str, model: &str) -> Arc<dyn SpeechModel> {
    Arc::new(ElevenLabsSpeechModel {
        client,
        base_url: base_url.trim_end_matches('/').to_owned(),
        api_key: api_key.to_owned(),
        model: model.to_owned(),
    })
}

/// `resolveSpeechModel`: one speech model on the route's key.
pub fn resolve_speech_model(
    model_id: &str,
    route: &ModelRoute,
    client: &reqwest::Client,
) -> Result<Arc<dyn SpeechModel>, ModelError> {
    let target = resolve_target(model_id, route)?;
    match target.provider {
        ProviderId::Elevenlabs => Ok(elevenlabs_speech_model(client.clone(), ELEVENLABS_BASE_URL, &target.api_key, &target.model)),
        ProviderId::Openai => Ok(Arc::new(OpenAiSpeechModel {
            client: client.clone(),
            url: format!("{}/audio/speech", target.base_url.as_deref().unwrap_or(OPENAI_BASE_URL)),
            api_key: target.api_key,
            model: target.model,
        })),
        ProviderId::Gateway => Ok(Arc::new(GatewaySpeechModel {
            client: client.clone(),
            url: format!("{}/speech-model", target.base_url.as_deref().unwrap_or(gateway::DEFAULT_BASE_URL)),
            api_key: target.api_key,
            model: target.model,
        })),
        _ => Err(ModelError::unsupported_model("This provider has no speech models.")),
    }
}
