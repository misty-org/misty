//! Reading the JSON and binary answers of non-chat models.
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::model_calls::error::{retryable_status, scrub, ModelError};

/// `createJsonResponseHandler`'s failure: the answer arrived but doesn't fit. It says nothing of
/// what the answer held, which could echo a key.
pub(super) fn invalid_json(status: u16) -> ModelError {
    ModelError::Api {
        status,
        message: "Invalid JSON response".into(),
        retryable: retryable_status(status),
        retry_after_ms: None,
    }
}

/// Reads a success body as `T`. Not being able to read it is a failure of the call.
pub(super) async fn read_json<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, ModelError> {
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|_| invalid_json(status))?;
    serde_json::from_str(&text).map_err(|_| invalid_json(status))
}

/// Reads a success body as bytes.
pub(super) async fn read_bytes(response: reqwest::Response) -> Result<Vec<u8>, ModelError> {
    let status = response.status().as_u16();
    response.bytes().await.map(|bytes| bytes.to_vec()).map_err(|_| ModelError::Api {
        status,
        message: "Failed to read response as array buffer".into(),
        retryable: retryable_status(status),
        retry_after_ms: None,
    })
}

/// A JSON body with the shape the SDK's `{ error: { message } }` handlers read.
pub(super) fn openai_error_message(body: &Value) -> Option<String> {
    Some(body.get("error")?.get("message")?.as_str()?.to_owned())
}

pub(super) fn network_error(error: &reqwest::Error, secret: &str) -> ModelError {
    ModelError::Network(scrub(&error.to_string(), secret))
}
