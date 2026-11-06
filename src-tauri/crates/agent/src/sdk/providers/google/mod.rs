//! Gemini through the Generative Language API. Ported from `@ai-sdk/google`. The key travels in the
//! `x-goog-api-key` header and never in a URL.
mod capabilities;
mod chunk;
mod decoder;
mod messages;
mod parts;
mod request;
mod schema;
mod schema_enum;

use futures_util::future::BoxFuture;
use serde_json::Value;

use crate::sdk::{
    call::CallOptions,
    error::ModelError,
    http::post_json,
    model::{decoded_stream, LanguageModel, ModelStream},
};

pub(crate) const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

pub(crate) struct GoogleModel {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
}

impl GoogleModel {
    pub(crate) fn new(client: reqwest::Client, base_url: &str, api_key: &str, model: &str) -> Self {
        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_owned(),
            api_key: api_key.to_owned(),
            model: model.to_owned(),
        }
    }
}

/// The failure shape Google documents. Anything else falls back to the status text.
pub(crate) fn error_message(body: &Value) -> Option<String> {
    let error = body.get("error")?;
    let code_fits = error.get("code").is_some_and(|code| code.is_number() || code.is_null());
    let status_fits = error.get("status").is_some_and(Value::is_string);
    if !code_fits || !status_fits {
        return None;
    }
    Some(error.get("message")?.as_str()?.to_owned())
}

fn model_path(model: &str) -> String {
    if model.contains('/') {
        model.to_owned()
    } else {
        format!("models/{model}")
    }
}

impl LanguageModel for GoogleModel {
    fn stream(&self, options: CallOptions) -> BoxFuture<'_, Result<ModelStream, ModelError>> {
        Box::pin(async move {
            let (body, warnings) = request::build(&self.model, &options)?;
            let url = format!("{}/{}:streamGenerateContent?alt=sse", self.base_url, model_path(&self.model));
            let headers = [("x-goog-api-key", self.api_key.clone())];
            let response = post_json(&self.client, &url, &headers, &body, &self.api_key, error_message).await?;
            Ok(decoded_stream(response, decoder::GoogleDecoder::new(warnings), &self.api_key))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_names_get_their_path() {
        assert_eq!(model_path("gemini-3-pro"), "models/gemini-3-pro");
        assert_eq!(model_path("tunedModels/mine"), "tunedModels/mine");
    }

    #[test]
    fn only_googles_failure_shape_gives_a_message() {
        let body = serde_json::json!({ "error": { "code": 400, "message": "Bad.", "status": "INVALID_ARGUMENT" } });
        assert_eq!(error_message(&body).as_deref(), Some("Bad."));
        assert_eq!(error_message(&serde_json::json!({ "error": { "message": "Bad." } })), None);
    }
}
