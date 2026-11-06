//! Transcription. `transcribe` is ported from the `ai` package, and the models from `@ai-sdk/openai`
//! and `@ai-sdk/gateway`, with Soniox in its own file.
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    http::{openai_error_message, read_json},
    multipart::Form,
    soniox::SonioxTranscriptionModel,
};
use crate::sdk::{
    error::ModelError,
    generate::{with_retries, DEFAULT_MAX_RETRIES},
    http::{failure, post_body},
    media_type::{detect_in_bytes, extension},
    prompt::ProviderOptions,
    providers::gateway::{self, auth_headers, checked},
    route::{resolve_target, ModelRoute, ProviderId},
};

const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub text: String,
    pub start_second: f64,
    pub end_second: f64,
}

#[derive(Clone, Debug, Default)]
pub struct TranscriptionResponse {
    pub text: String,
    pub segments: Vec<TranscriptSegment>,
    pub language: Option<String>,
    pub duration_in_seconds: Option<f64>,
    pub warnings: Vec<Value>,
    pub provider_metadata: Option<Value>,
}

pub trait TranscriptionModel: Send + Sync {
    fn do_generate<'a>(
        &'a self,
        audio: &'a [u8],
        media_type: &'a str,
        provider_options: Option<&'a ProviderOptions>,
    ) -> BoxFuture<'a, Result<TranscriptionResponse, ModelError>>;
}

/// `max_retries` of `None` is the SDK's default of 2.
pub async fn transcribe(
    model: &dyn TranscriptionModel,
    audio: &[u8],
    provider_options: Option<&ProviderOptions>,
    max_retries: Option<u32>,
) -> Result<TranscriptionResponse, ModelError> {
    let media_type = detect_in_bytes(audio, "audio").unwrap_or("audio/wav");
    let result = with_retries(max_retries.unwrap_or(DEFAULT_MAX_RETRIES), || {
        model.do_generate(audio, media_type, provider_options)
    })
    .await?;
    if result.text.is_empty() {
        return Err(ModelError::NoOutput {
            name: "AI_NoTranscriptGeneratedError",
            message: "No transcript generated.".into(),
        });
    }
    Ok(result)
}

#[derive(Deserialize)]
struct OpenAiSegment {
    text: String,
    start: f64,
    end: f64,
}

#[derive(Deserialize)]
struct OpenAiWord {
    word: String,
    start: f64,
    end: f64,
}

#[derive(Deserialize)]
struct OpenAiTranscript {
    text: String,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    words: Option<Vec<OpenAiWord>>,
    #[serde(default)]
    segments: Option<Vec<OpenAiSegment>>,
}

/// OpenAI names a language in full, and the SDK reports its ISO-639-1 code.
fn language_code(language: &str) -> Option<&'static str> {
    Some(match language {
        "afrikaans" => "af",
        "arabic" => "ar",
        "armenian" => "hy",
        "azerbaijani" => "az",
        "belarusian" => "be",
        "bosnian" => "bs",
        "bulgarian" => "bg",
        "catalan" => "ca",
        "chinese" => "zh",
        "croatian" => "hr",
        "czech" => "cs",
        "danish" => "da",
        "dutch" => "nl",
        "english" => "en",
        "estonian" => "et",
        "finnish" => "fi",
        "french" => "fr",
        "galician" => "gl",
        "german" => "de",
        "greek" => "el",
        "hebrew" => "he",
        "hindi" => "hi",
        "hungarian" => "hu",
        "icelandic" => "is",
        "indonesian" => "id",
        "italian" => "it",
        "japanese" => "ja",
        "kannada" => "kn",
        "kazakh" => "kk",
        "korean" => "ko",
        "latvian" => "lv",
        "lithuanian" => "lt",
        "macedonian" => "mk",
        "malay" => "ms",
        "marathi" => "mr",
        "maori" => "mi",
        "nepali" => "ne",
        "norwegian" => "no",
        "persian" => "fa",
        "polish" => "pl",
        "portuguese" => "pt",
        "romanian" => "ro",
        "russian" => "ru",
        "serbian" => "sr",
        "slovak" => "sk",
        "slovenian" => "sl",
        "spanish" => "es",
        "swahili" => "sw",
        "swedish" => "sv",
        "tagalog" => "tl",
        "tamil" => "ta",
        "thai" => "th",
        "turkish" => "tr",
        "ukrainian" => "uk",
        "urdu" => "ur",
        "vietnamese" => "vi",
        "welsh" => "cy",
        _ => return None,
    })
}

struct OpenAiTranscriptionModel {
    client: reqwest::Client,
    url: String,
    api_key: String,
    model: String,
}

impl TranscriptionModel for OpenAiTranscriptionModel {
    // The runtime passes OpenAI no provider options, so none are read.
    fn do_generate<'a>(
        &'a self,
        audio: &'a [u8],
        media_type: &'a str,
        _provider_options: Option<&'a ProviderOptions>,
    ) -> BoxFuture<'a, Result<TranscriptionResponse, ModelError>> {
        Box::pin(async move {
            if self.model == "gpt-realtime-whisper" || self.model.starts_with("gpt-realtime-whisper-") {
                return Err(ModelError::Unsupported(format!(
                    "'non-streaming transcription with {}' functionality not supported.",
                    self.model
                )));
            }
            let mut form = Form::new();
            form.text("model", &self.model);
            form.file("file", &format!("audio.{}", extension(media_type)), media_type, audio);
            if self.model == "whisper-1" {
                form.text("response_format", "verbose_json");
            }
            let content_type = form.content_type();
            let headers = [("authorization", format!("Bearer {}", self.api_key))];
            let response = post_body(&self.client, &self.url, &headers, &content_type, form.finish(), &self.api_key).await?;
            if !response.status().is_success() {
                return Err(failure(response, &self.api_key, openai_error_message).await);
            }
            let parsed: OpenAiTranscript = read_json(response).await?;
            let segments = match (parsed.segments, parsed.words) {
                (Some(segments), _) => segments
                    .into_iter()
                    .map(|segment| TranscriptSegment { text: segment.text, start_second: segment.start, end_second: segment.end })
                    .collect(),
                (None, Some(words)) => words
                    .into_iter()
                    .map(|word| TranscriptSegment { text: word.word, start_second: word.start, end_second: word.end })
                    .collect(),
                (None, None) => Vec::new(),
            };
            Ok(TranscriptionResponse {
                text: parsed.text,
                segments,
                language: parsed.language.as_deref().and_then(language_code).map(str::to_owned),
                duration_in_seconds: parsed.duration,
                warnings: Vec::new(),
                provider_metadata: None,
            })
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayTranscript {
    text: String,
    #[serde(default)]
    segments: Vec<TranscriptSegment>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    duration_in_seconds: Option<f64>,
    #[serde(default)]
    warnings: Vec<Value>,
    #[serde(default)]
    provider_metadata: Option<Value>,
}

struct GatewayTranscriptionModel {
    client: reqwest::Client,
    url: String,
    api_key: String,
    model: String,
}

impl TranscriptionModel for GatewayTranscriptionModel {
    fn do_generate<'a>(
        &'a self,
        audio: &'a [u8],
        media_type: &'a str,
        provider_options: Option<&'a ProviderOptions>,
    ) -> BoxFuture<'a, Result<TranscriptionResponse, ModelError>> {
        Box::pin(async move {
            // The SDK always passes provider options here, even when there are none.
            let body = json!({
                "audio": STANDARD.encode(audio),
                "mediaType": media_type,
                "providerOptions": provider_options.cloned().unwrap_or_default(),
            });
            let bytes = serde_json::to_vec(&body)
                .map_err(|error| ModelError::Unsupported(format!("The request couldn't be built: {error}")))?;
            let mut headers = auth_headers(&self.api_key);
            headers.push(("ai-transcription-model-specification-version", "4".to_owned()));
            headers.push(("ai-model-id", self.model.clone()));
            let response = post_body(&self.client, &self.url, &headers, "application/json", bytes, &self.api_key).await?;
            let response = checked(response, &self.api_key).await?;
            let parsed: GatewayTranscript = read_json(response).await?;
            Ok(TranscriptionResponse {
                text: parsed.text,
                segments: parsed.segments,
                language: parsed.language,
                duration_in_seconds: parsed.duration_in_seconds,
                warnings: parsed.warnings,
                provider_metadata: parsed.provider_metadata,
            })
        })
    }
}

/// `resolveTranscriptionModel`: one transcription model on the route's key.
pub fn resolve_transcription_model(
    model_id: &str,
    route: &ModelRoute,
    client: &reqwest::Client,
) -> Result<Arc<dyn TranscriptionModel>, ModelError> {
    let target = resolve_target(model_id, route)?;
    match target.provider {
        ProviderId::Soniox => Ok(Arc::new(SonioxTranscriptionModel::new(
            client.clone(),
            target.base_url.as_deref(),
            &target.api_key,
            &target.model,
        )?)),
        ProviderId::Openai => Ok(Arc::new(OpenAiTranscriptionModel {
            client: client.clone(),
            url: format!("{}/audio/transcriptions", target.base_url.as_deref().unwrap_or(OPENAI_BASE_URL)),
            api_key: target.api_key,
            model: target.model,
        })),
        ProviderId::Gateway => Ok(Arc::new(GatewayTranscriptionModel {
            client: client.clone(),
            url: format!("{}/transcription-model", target.base_url.as_deref().unwrap_or(gateway::DEFAULT_BASE_URL)),
            api_key: target.api_key,
            model: target.model,
        })),
        _ => Err(ModelError::unsupported_model("This provider has no transcription models.")),
    }
}
