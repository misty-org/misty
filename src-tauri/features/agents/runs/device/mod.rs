//! Model calls the desktop makes outside agent runs, on the runtime on its own computer
//! the desktop has the input, so the server is never asked. Each call runs
//! on the device's model for its role and key for that model's provider.
//!
//! The `/v1/device/*` table in `src/index.ts` is one method here per route, and
//! [`DeviceCalls::device_call`] dispatches by the route's name. Dropping a call's future cancels it.
mod day_summary;
pub(crate) mod device_calls;
mod device_routing;
mod failure;
pub(crate) mod model_calls;
mod model_checks;
mod models;
mod screen_calls;
mod subtitle_context;
mod text_calls;
mod transcribe_diarized;
mod voice_notes;
pub(crate) mod zod;

use std::sync::Arc;

use serde_json::Value;

pub use failure::{model_call_failure, CallError, DeviceCallFailure};
pub use model_calls::{embed_call, speech_call, EmbedCall, EmbedImage, SpeechCall};
pub use models::{DeviceModels, DeviceRole};

use super::js_json::JsValue;
use crate::model_calls::{ModelError, ModelRoute};
use failure::answered;

/// The route's limit: the desktop's model calls carry screenshots and recordings.
pub const MAX_DEVICE_BODY_BYTES: usize = 40 << 20;

/// Every call [`DeviceCalls::device_call`] knows, by its route's name.
pub const DEVICE_CALL_NAMES: [&str; 13] = [
    "cleanup",
    "voice-transcription",
    "screen-model",
    "refine-point",
    "subtitle-context",
    "extract",
    "embed",
    "day-summary",
    "voice-notes",
    "transcribe-diarized",
    "model-test",
    "follow-up",
    "restore-step",
];

/// The body as `express.json` read it: within the limit, and an object or array. An empty body reads
/// as `{}`. Text rather than a parsed value, because a run's schema goes to the model in its own key
/// order.
fn read_body(body: &str) -> Result<JsValue, CallError> {
    if body.len() > MAX_DEVICE_BODY_BYTES {
        return Err(CallError::call(413, "body_too_large", "This model call is too large."));
    }
    if body.is_empty() {
        return Ok(JsValue::Object(Vec::new()));
    }
    JsValue::parse(body).filter(|value| value.is_object() || value.as_array().is_some()).ok_or_else(CallError::invalid)
}

/// This computer's model calls.
pub struct DeviceCalls {
    pub(crate) models: Arc<dyn DeviceModels>,
    pub(crate) client: reqwest::Client,
}

impl DeviceCalls {
    pub fn new(models: Arc<dyn DeviceModels>, client: reqwest::Client) -> Self {
        Self { models, client }
    }

    /// `onDevice`: the model for a role, on this device's key for its provider.
    pub(crate) fn on_device(&self, role: DeviceRole) -> Result<(String, ModelRoute), ModelError> {
        let model = self.models.model_id(role).ok_or_else(|| ModelError::Setup {
            code: "model_key_needed",
            detail: "Choose a model in Settings → Models.".to_owned(),
        })?;
        let route = self.models.route(&model)?;
        Ok((model, route))
    }

    /// One call by its route's name, with the route's validation, status and body. A name that isn't
    /// in [`DEVICE_CALL_NAMES`] is the route's 404.
    pub async fn device_call(&self, name: &str, body: &str) -> Result<Value, DeviceCallFailure> {
        match name {
            "cleanup" => self.cleanup(body).await,
            "voice-transcription" => self.voice_transcription(body).await,
            "screen-model" => self.screen_model(body).await,
            "refine-point" => self.refine_point(body).await,
            "subtitle-context" => self.subtitle_context(body).await,
            "extract" => self.extract(body).await,
            "embed" => self.embed(body).await,
            "day-summary" => self.day_summary(body).await,
            "voice-notes" => self.voice_notes(body).await,
            "transcribe-diarized" => self.transcribe_diarized(body).await,
            "model-test" => self.model_test(body).await,
            "follow-up" => self.follow_up(body).await,
            "restore-step" => self.restore_step(body).await,
            _ => Err(DeviceCallFailure { status: 404, body: serde_json::json!({ "code": "not_found" }) }),
        }
    }

    pub async fn cleanup(&self, body: &str) -> Result<Value, DeviceCallFailure> {
        let result = match read_body(body) {
            Ok(body) => device_calls::cleanup_call(self, &body).await,
            Err(error) => Err(error),
        };
        answered("cleanup", result)
    }

    pub async fn voice_transcription(&self, body: &str) -> Result<Value, DeviceCallFailure> {
        let result = match read_body(body) {
            Ok(body) => device_calls::voice_transcription_call(self, &body).await,
            Err(error) => Err(error),
        };
        answered("voice-transcription", result)
    }

    pub async fn screen_model(&self, body: &str) -> Result<Value, DeviceCallFailure> {
        let result = match read_body(body) {
            Ok(body) => screen_calls::screen_model_call(self, &body).await,
            Err(error) => Err(error),
        };
        answered("screen-model", result)
    }

    pub async fn refine_point(&self, body: &str) -> Result<Value, DeviceCallFailure> {
        let result = match read_body(body) {
            Ok(body) => screen_calls::refine_point_call(self, &body).await,
            Err(error) => Err(error),
        };
        answered("refine-point", result)
    }

    pub async fn subtitle_context(&self, body: &str) -> Result<Value, DeviceCallFailure> {
        let result = match read_body(body) {
            Ok(body) => subtitle_context::subtitle_context_call(self, &body).await,
            Err(error) => Err(error),
        };
        answered("subtitle-context", result)
    }

    pub async fn extract(&self, body: &str) -> Result<Value, DeviceCallFailure> {
        let result = match read_body(body) {
            Ok(body) => text_calls::extract_call(self, &body).await,
            Err(error) => Err(error),
        };
        answered("extract", result)
    }

    /// Vectors for search and memory, on the device's embedding model at the server's dimensions.
    pub async fn embed(&self, body: &str) -> Result<Value, DeviceCallFailure> {
        let result = match read_body(body) {
            Ok(body) => self.embed_body(&body).await,
            Err(error) => Err(error),
        };
        answered("embed", result)
    }

    async fn embed_body(&self, body: &JsValue) -> Result<Value, CallError> {
        use zod::{array, checked, integer, object, string};
        let (values, dimensions) = checked(|| {
            let request = object(body)?;
            let values = array(request.get("values"), 1, 64)?
                .iter()
                .map(|value| string(Some(value), 256 << 10).map(str::to_owned))
                .collect::<Option<Vec<_>>>()?;
            Some((values, integer(request.get("dimensions"), 1.0, 4096.0)? as u32))
        })?;
        let (model, route) = self.on_device(DeviceRole::Embedding)?;
        let call = EmbedCall { route: &route, model: &model, values: &values, dimensions: Some(dimensions), images: None };
        let embeddings = embed_call(&self.client, call).await?;
        if embeddings.iter().any(|vector| vector.len() != dimensions as usize) {
            return Err(CallError::Call {
                status: 422,
                code: "embedding_dimensions",
                message: format!("The embedding model must give {dimensions}-number vectors."),
            });
        }
        Ok(serde_json::json!({ "model": model, "embeddings": embeddings }))
    }

    /// One day of the person's Memory, summarized on the device's fast model. The server sends the
    /// day's items (memory_day_api.go).
    pub async fn day_summary(&self, body: &str) -> Result<Value, DeviceCallFailure> {
        let result = async {
            let (model, route) = self.on_device(DeviceRole::Fast)?;
            day_summary::day_summary_call(self, &model, &route, &read_body(body)?, 1200).await
        };
        answered("day-summary", result.await)
    }

    /// A Note from a recording's transcript, on the device's agent model (voice_notes_api.go).
    pub async fn voice_notes(&self, body: &str) -> Result<Value, DeviceCallFailure> {
        let result = async {
            let (model, route) = self.on_device(DeviceRole::Agent)?;
            voice_notes::voice_notes_call(self, &model, &route, &read_body(body)?).await
        };
        answered("voice-notes", result.await)
    }

    /// Who said what in a Library recording. Speaker turns need Soniox's async model, so the device
    /// needs a Soniox key for this, whatever its transcription model is.
    pub async fn transcribe_diarized(&self, body: &str) -> Result<Value, DeviceCallFailure> {
        const MODEL: &str = "soniox/stt-async-v4";
        let result = async {
            let route = self.models.route(MODEL)?;
            transcribe_diarized::transcribe_diarized_call(self, MODEL, &route, &read_body(body)?).await
        };
        answered("transcribe-diarized", result.await)
    }

    pub async fn model_test(&self, body: &str) -> Result<Value, DeviceCallFailure> {
        let result = async {
            read_body(body)?;
            model_checks::model_test_call(self).await
        };
        answered("model-test", result.await)
    }

    pub async fn follow_up(&self, body: &str) -> Result<Value, DeviceCallFailure> {
        let result = match read_body(body) {
            Ok(body) => device_routing::follow_up_call(self, &body).await,
            Err(error) => Err(error),
        };
        answered("follow-up", result)
    }

    pub async fn restore_step(&self, body: &str) -> Result<Value, DeviceCallFailure> {
        let result = match read_body(body) {
            Ok(body) => device_routing::restore_step_call(self, &body).await,
            Err(error) => Err(error),
        };
        answered("restore-step", result)
    }
}
