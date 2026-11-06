//! Claude over the Messages API. Ported from `@ai-sdk/anthropic`.
mod cache_control;
mod capabilities;
mod chunk;
mod decoder;
mod prompt;
mod request;
mod schema;
mod tools;
mod usage;
mod user_content;
mod wire;

use futures_util::{future::BoxFuture, stream, StreamExt};
use serde_json::Value;

use crate::sdk::{
    call::CallOptions,
    error::ModelError,
    http::post_json,
    model::{decoded_stream, LanguageModel, ModelStream},
    stream::StreamPart,
};

const API_URL: &str = "https://api.anthropic.com";

pub(crate) struct AnthropicModel {
    client: reqwest::Client,
    url: String,
    api_key: String,
    model: String,
}

impl AnthropicModel {
    pub(crate) fn new(client: reqwest::Client, base_url: Option<&str>, api_key: &str, model: &str) -> Self {
        let base = base_url.unwrap_or(API_URL).trim_end_matches('/');
        // Anthropic's bare address means its versioned API.
        let base = if base == API_URL { format!("{API_URL}/v1") } else { base.to_owned() };
        Self {
            client,
            url: format!("{base}/messages"),
            api_key: api_key.to_owned(),
            model: model.to_owned(),
        }
    }
}

fn error_message(body: &Value) -> Option<String> {
    if body.get("type")?.as_str()? != "error" {
        return None;
    }
    let error = body.get("error")?;
    error.get("type")?.as_str()?;
    Some(error.get("message")?.as_str()?.to_owned())
}

/// Anthropic can answer 200 and then fail straight away, such as when it's overloaded. That is
/// still the call failing, so it's reported the way a failed request is.
fn failure_before_output(error: &Value) -> ModelError {
    let text = |name: &str| error.get(name).and_then(Value::as_str);
    let message = text("message").unwrap_or_default().to_owned();
    // The connection dropped rather than Anthropic saying anything.
    if text("name") == Some("AI_APICallError") {
        return ModelError::Network(message);
    }
    let overloaded = text("type") == Some("overloaded_error");
    ModelError::Api {
        status: if overloaded { 529 } else { 500 },
        message,
        retryable: overloaded,
        retry_after_ms: None,
    }
}

impl LanguageModel for AnthropicModel {
    fn stream(&self, options: CallOptions) -> BoxFuture<'_, Result<ModelStream, ModelError>> {
        Box::pin(async move {
            let built = request::build(&self.model, &options)?;
            let mut headers = vec![
                ("anthropic-version", "2023-06-01".to_owned()),
                ("x-api-key", self.api_key.clone()),
            ];
            if !built.betas.is_empty() {
                headers.push(("anthropic-beta", built.betas.join(",")));
            }
            let response =
                post_json(&self.client, &self.url, &headers, &built.body, &self.api_key, error_message).await?;
            let decoder = decoder::AnthropicDecoder::new(built.warnings, built.uses_json_response_tool);
            let mut parts = decoded_stream(response, decoder, &self.api_key).fuse();
            // The first part is always `stream-start`, and the next tells whether this worked.
            let mut seen = Vec::with_capacity(2);
            seen.extend(parts.next().await);
            let second = parts.next().await;
            if let Some(StreamPart::Error { error }) = &second {
                return Err(failure_before_output(error));
            }
            seen.extend(second);
            let parts: ModelStream = Box::pin(stream::iter(seen).chain(parts));
            Ok(parts)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url_for(base_url: Option<&str>) -> String {
        let _ = rustls::crypto::ring::default_provider().install_default();
        AnthropicModel::new(reqwest::Client::new(), base_url, "key", "m").url
    }

    #[test]
    fn the_bare_address_means_the_versioned_api() {
        assert_eq!(url_for(None), "https://api.anthropic.com/v1/messages");
        assert_eq!(url_for(Some("https://api.anthropic.com")), "https://api.anthropic.com/v1/messages");
        assert_eq!(url_for(Some("https://proxy.example/anthropic")), "https://proxy.example/anthropic/messages");
    }
}
