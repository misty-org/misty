//! The Soniox key one live session runs on: the device's own, which lives only in the session's
//! memory (`live/credential.ts`).
use super::super::device::{model_call_failure, CallError, DeviceCallFailure, DeviceModels};
use super::session::LiveSessionSpec;
use super::soniox_stream::SonioxFactory;
use crate::model_calls::{parse_model_id, resolve_transcription_model, ModelError, ProviderId};

/// `liveSonioxKey`. The key is checked as any model's is, through the same route.
pub(crate) fn live_soniox_key(models: &dyn DeviceModels, model: &str, client: &reqwest::Client) -> Result<String, ModelError> {
    let (provider, _) = parse_model_id(model)?;
    if provider != ProviderId::Soniox {
        return Err(ModelError::Setup {
            code: "model_unsupported",
            detail: "Live transcription runs on Soniox models.".to_owned(),
        });
    }
    let route = models.route(model)?;
    resolve_transcription_model(model, &route, client)?;
    Ok(route.credential.api_key.trim().to_owned())
}

/// The session's way to Soniox, or why it can't have one as a refusal the desktop can act on; never
/// the key.
pub fn open_soniox(models: &dyn DeviceModels, spec: &LiveSessionSpec, client: &reqwest::Client) -> Result<SonioxFactory, DeviceCallFailure> {
    match live_soniox_key(models, &spec.model, client) {
        Ok(key) => Ok(SonioxFactory::new(key)),
        Err(error @ ModelError::Setup { .. }) => Err(model_call_failure(&CallError::Model(error))),
        Err(_) => Err(DeviceCallFailure {
            status: 503,
            body: serde_json::json!({ "code": "live_transcription_unavailable", "message": "Live transcription isn't available right now." }),
        }),
    }
}
