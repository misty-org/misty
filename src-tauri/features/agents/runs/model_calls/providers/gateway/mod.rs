//! Vercel's AI Gateway, as `createGateway` from the `ai` package talks to it. The Gateway takes a
//! call's options as they are and answers with the SDK's own stream parts.
mod decoder;

use futures_util::future::BoxFuture;
use serde_json::Value;

use crate::model_calls::call::CallOptions;
use crate::model_calls::error::{retryable_status, scrub, ModelError};
use crate::model_calls::http::{post_body, retry_after};
use crate::model_calls::model::{decoded_stream, LanguageModel, ModelStream};

pub(crate) const DEFAULT_BASE_URL: &str = "https://ai-gateway.vercel.sh/v4/ai";
const PROTOCOL_VERSION: &str = "0.0.1";

const AUTH_FAILED: &str = "AI Gateway authentication failed: Invalid API key or token.

Create a new API key: https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys

Provide an API key or Vercel access token via 'apiKey' option or 'AI_GATEWAY_API_KEY' environment variable.";

pub(crate) struct GatewayModel {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
}

impl GatewayModel {
    pub(crate) fn new(client: reqwest::Client, base_url: &str, api_key: &str, model: &str) -> Self {
        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_owned(),
            api_key: api_key.to_owned(),
            model: model.to_owned(),
        }
    }
}

/// The headers on every Gateway call. The key goes only in `authorization`.
pub(crate) fn auth_headers(api_key: &str) -> Vec<(&'static str, String)> {
    vec![
        ("authorization", format!("Bearer {api_key}")),
        ("ai-gateway-protocol-version", PROTOCOL_VERSION.to_owned()),
        ("ai-gateway-auth-method", "api-key".to_owned()),
    ]
}

/// `createGatewayErrorFromResponse`: what the person reads. The class of error stays in the status.
fn failure_message(body: &str) -> String {
    let invalid = || "Invalid error response format: Gateway request failed".to_owned();
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return invalid();
    };
    let Some(error) = value.get("error").filter(|error| error.is_object()) else {
        return invalid();
    };
    let Some(message) = error.get("message").and_then(Value::as_str) else {
        return invalid();
    };
    let nullish = |field: Option<&Value>, fits: fn(&Value) -> bool| field.map_or(true, |field| field.is_null() || fits(field));
    let fits = nullish(error.get("type"), Value::is_string)
        && nullish(error.get("code"), |code| code.is_string() || code.is_number())
        && nullish(value.get("generationId"), Value::is_string);
    if !fits {
        return invalid();
    }
    let text = match error.get("type").and_then(Value::as_str) {
        Some("authentication_error") => AUTH_FAILED,
        _ => message,
    };
    match value.get("generationId").and_then(Value::as_str) {
        Some(generation) => format!("{text} [{generation}]"),
        None => text.to_owned(),
    }
}

/// Turns any response the Gateway refused into its error.
pub(crate) async fn checked(response: reqwest::Response, secret: &str) -> Result<reqwest::Response, ModelError> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status().as_u16();
    let retry_after_ms = retry_after(response.headers());
    let text = response.text().await.unwrap_or_default();
    Err(ModelError::Api {
        status,
        message: scrub(&failure_message(&text), secret),
        retryable: retryable_status(status),
        retry_after_ms,
    })
}

impl LanguageModel for GatewayModel {
    fn stream(&self, options: CallOptions) -> BoxFuture<'_, Result<ModelStream, ModelError>> {
        Box::pin(async move {
            let body = serde_json::to_vec(&options)
                .map_err(|error| ModelError::Unsupported(format!("The request couldn't be built: {error}")))?;
            let mut headers = auth_headers(&self.api_key);
            headers.push(("ai-language-model-specification-version", "4".to_owned()));
            headers.push(("ai-language-model-id", self.model.clone()));
            headers.push(("ai-language-model-streaming", "true".to_owned()));
            let url = format!("{}/language-model", self.base_url);
            let response =
                post_body(&self.client, &url, &headers, "application/json", body, &self.api_key).await?;
            let response = checked(response, &self.api_key).await?;
            Ok(decoded_stream(response, decoder::GatewayDecoder::default(), &self.api_key))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failure_messages_come_from_the_gateways_shape() {
        assert_eq!(failure_message(r#"{"error":{"message":"Slow down.","type":"rate_limit_exceeded"}}"#), "Slow down.");
        assert_eq!(
            failure_message(r#"{"error":{"message":"Nope.","type":"forbidden"},"generationId":"gen_1"}"#),
            "Nope. [gen_1]",
        );
        assert!(failure_message(r#"{"error":{"message":"Bad key sk-1","type":"authentication_error"}}"#).starts_with("AI Gateway authentication failed: Invalid API key or token."));
        for bad in ["", "not json", r#"{"error":"text"}"#, r#"{"error":{"type":"x"}}"#] {
            assert_eq!(failure_message(bad), "Invalid error response format: Gateway request failed", "{bad}");
        }
    }
}
