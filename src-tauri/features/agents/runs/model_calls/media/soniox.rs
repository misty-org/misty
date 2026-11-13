//! Soniox transcription: upload the file, start a job, wait for it, read the transcript, and clean
//! up after. Ported from `SonioxTranscriptionModel` in `@soniox/vercel-ai-sdk-provider`.
use std::time::Duration;

use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    http::{invalid_json, read_json},
    multipart::Form,
    soniox_job::{job_body, language_from_tokens, picked_token, segment},
    transcription::{TranscriptionModel, TranscriptionResponse},
};
use crate::model_calls::error::{scrub, ModelError};
use crate::model_calls::http::{failure, post_body, post_json};
use crate::model_calls::media_type::extension;
use crate::model_calls::prompt::ProviderOptions;

const DEFAULT_BASE_URL: &str = "https://api.soniox.com";
const POLLING_INTERVAL: Duration = Duration::from_secs(1);
const TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub(super) struct SonioxTranscriptionModel {
    client: reqwest::Client,
    base_url: reqwest::Url,
    api_key: String,
    model: String,
}

#[derive(Deserialize)]
struct Created {
    id: String,
}

#[derive(Deserialize)]
struct Status {
    status: String,
    #[serde(default)]
    audio_duration_ms: Option<f64>,
    #[serde(default)]
    error_message: Option<String>,
}

#[derive(Deserialize)]
struct Transcript {
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    tokens: Option<Vec<Value>>,
}

/// `{ message ?? error_type ?? "Soniox API error" }`.
fn error_message(body: &Value) -> Option<String> {
    if !body.is_object() {
        return None;
    }
    let text = |key: &str| body.get(key).and_then(Value::as_str).map(str::to_owned);
    Some(text("message").or_else(|| text("error_type")).unwrap_or_else(|| "Soniox API error".to_owned()))
}

fn failed_job(name: &'static str, message: String) -> ModelError {
    ModelError::NoOutput { name, message }
}

impl SonioxTranscriptionModel {
    pub(super) fn new(client: reqwest::Client, base_url: Option<&str>, api_key: &str, model: &str) -> Result<Self, ModelError> {
        let base_url = reqwest::Url::parse(base_url.unwrap_or(DEFAULT_BASE_URL))
            .map_err(|_| ModelError::bad_base_url("The model's base URL isn't a valid URL."))?;
        Ok(Self { client, base_url, api_key: api_key.to_owned(), model: model.to_owned() })
    }

    /// `new URL(path, base)`: paths start at the root, whatever path the base has.
    fn url(&self, path: &str) -> Result<String, ModelError> {
        self.base_url
            .join(path)
            .map(String::from)
            .map_err(|_| ModelError::bad_base_url("The model's base URL isn't a valid URL."))
    }

    fn bearer(&self) -> String {
        format!("Bearer {}", self.api_key)
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, ModelError> {
        let response = self
            .client
            .get(self.url(path)?)
            .header("authorization", self.bearer())
            .send()
            .await
            .map_err(|error| super::http::network_error(&error, &self.api_key))?;
        if !response.status().is_success() {
            return Err(failure(response, &self.api_key, error_message).await);
        }
        read_json(response).await
    }

    async fn delete(&self, path: &str, description: &str, warnings: &mut Vec<Value>) {
        let outcome = self.try_delete(path).await;
        if let Err(message) = outcome {
            warnings.push(json!({
                "type": "other",
                "message": scrub(&format!("Failed to auto-delete {description}: {message}"), &self.api_key),
            }));
        }
    }

    async fn try_delete(&self, path: &str) -> Result<(), String> {
        let url = self.url(path).map_err(|error| error.to_string())?;
        let response = self
            .client
            .delete(url)
            .header("authorization", self.bearer())
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if response.status().is_success() {
            return Ok(());
        }
        let status = response.status();
        let reason = status.canonical_reason().unwrap_or("");
        let text = response.text().await.unwrap_or_default();
        let suffix = if text.is_empty() { String::new() } else { format!(": {text}") };
        Err(format!("HTTP {} {reason}{suffix}", status.as_u16()))
    }

    async fn upload(&self, audio: &[u8], media_type: &str) -> Result<String, ModelError> {
        let mut form = Form::new();
        form.file("file", &format!("audio.{}", extension(media_type)), media_type, audio);
        let content_type = form.content_type();
        let url = self.url("/v1/files")?;
        let headers = [("authorization", self.bearer())];
        let response = post_body(&self.client, &url, &headers, &content_type, form.finish(), &self.api_key).await?;
        if !response.status().is_success() {
            return Err(failure(response, &self.api_key, error_message).await);
        }
        Ok(read_json::<Created>(response).await?.id)
    }

    async fn wait_for(&self, transcription_id: &str) -> Result<Status, ModelError> {
        let started = std::time::Instant::now();
        loop {
            if started.elapsed() > TIMEOUT {
                return Err(failed_job("TranscriptionJobPollingTimedOut", "Transcription job polling timed out".into()));
            }
            let status: Status = self.get(&format!("/v1/transcriptions/{transcription_id}")).await?;
            match status.status.as_str() {
                "completed" => return Ok(status),
                "error" => {
                    let detail = status.error_message.as_deref().unwrap_or("Unknown error");
                    let message = scrub(&format!("Transcription failed: {detail}"), &self.api_key);
                    return Err(failed_job("TranscriptionJobFailed", message));
                }
                _ => tokio::time::sleep(POLLING_INTERVAL).await,
            }
        }
    }

    async fn run(
        &self,
        audio: &[u8],
        media_type: &str,
        options: Option<&ProviderOptions>,
        file_id: &mut Option<String>,
        job_id: &mut Option<String>,
    ) -> Result<TranscriptionResponse, ModelError> {
        let uploaded = self.upload(audio, media_type).await?;
        *file_id = Some(uploaded.clone());
        let body = job_body(&self.model, &uploaded, options);
        let headers = [("authorization", self.bearer())];
        let url = self.url("/v1/transcriptions")?;
        let response = post_json(&self.client, &url, &headers, &body, &self.api_key, error_message).await?;
        let job = read_json::<Created>(response).await?.id;
        *job_id = Some(job.clone());
        let status = self.wait_for(&job).await?;
        let transcript: Transcript = self.get(&format!("/v1/transcriptions/{job}/transcript")).await?;
        let tokens = transcript
            .tokens
            .unwrap_or_default()
            .iter()
            .map(picked_token)
            .collect::<Option<Vec<Value>>>()
            .ok_or_else(|| invalid_json(200))?;
        Ok(TranscriptionResponse {
            text: transcript.text.unwrap_or_default(),
            segments: tokens.iter().filter_map(segment).collect(),
            language: language_from_tokens(&tokens),
            duration_in_seconds: status.audio_duration_ms.map(|ms| ms / 1000.0),
            warnings: Vec::new(),
            provider_metadata: Some(json!({ "soniox": { "tokens": tokens } })),
        })
    }
}

impl TranscriptionModel for SonioxTranscriptionModel {
    fn do_generate<'a>(
        &'a self,
        audio: &'a [u8],
        media_type: &'a str,
        provider_options: Option<&'a ProviderOptions>,
    ) -> BoxFuture<'a, Result<TranscriptionResponse, ModelError>> {
        Box::pin(async move {
            let mut file_id = None;
            let mut job_id = None;
            let result = self.run(audio, media_type, provider_options, &mut file_id, &mut job_id).await;
            // What was uploaded doesn't stay on Soniox's servers, whether or not the job worked.
            let mut warnings = Vec::new();
            if let Some(job) = &job_id {
                self.delete(&format!("/v1/transcriptions/{job}"), &format!("transcription {job}"), &mut warnings).await;
            }
            if let Some(file) = &file_id {
                self.delete(&format!("/v1/files/{file}"), &format!("file {file}"), &mut warnings).await;
            }
            result.map(|mut response| {
                response.warnings = warnings;
                response
            })
        })
    }
}
