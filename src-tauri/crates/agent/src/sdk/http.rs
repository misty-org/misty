//! Posting a model call and reading a provider's failures.
use serde::Serialize;
use serde_json::Value;

use super::error::{retryable_status, scrub, ModelError};

/// Sends a JSON body, returning the response when the provider accepted it. `error_message` finds
/// the provider's own explanation in a JSON failure body.
pub(crate) async fn post_json<B: Serialize>(
    client: &reqwest::Client,
    url: &str,
    headers: &[(&str, String)],
    body: &B,
    secret: &str,
    error_message: fn(&Value) -> Option<String>,
) -> Result<reqwest::Response, ModelError> {
    let bytes = serde_json::to_vec(body)
        .map_err(|error| ModelError::Unsupported(format!("The request couldn't be built: {error}")))?;
    let mut request = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(bytes);
    for (name, value) in headers {
        request = request.header(*name, value);
    }
    let response = request
        .send()
        .await
        .map_err(|error| ModelError::Network(scrub(&error.to_string(), secret)))?;
    if response.status().is_success() {
        return Ok(response);
    }
    Err(failure(response, secret, error_message).await)
}

async fn failure(
    response: reqwest::Response,
    secret: &str,
    error_message: fn(&Value) -> Option<String>,
) -> ModelError {
    let status = response.status();
    let retry_after_ms = retry_after(response.headers());
    let reason = status.canonical_reason().unwrap_or("Request failed").to_owned();
    let text = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| error_message(&value))
        .unwrap_or(reason);
    ModelError::Api {
        status: status.as_u16(),
        message: scrub(&message, secret),
        retryable: retryable_status(status.as_u16()),
        retry_after_ms,
    }
}

fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
    if let Some(ms) = header("retry-after-ms").and_then(|value| value.parse::<f64>().ok()) {
        return (ms >= 0.0).then_some(ms as u64);
    }
    let seconds = header("retry-after")?.parse::<f64>().ok()?;
    (seconds >= 0.0).then_some((seconds * 1000.0) as u64)
}
