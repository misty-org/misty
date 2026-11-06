//! OpenAI's Responses API. Ported from `@ai-sdk/openai`'s `responses` model.
mod assistant_input;
mod capabilities;
mod chunk;
mod decoder;
mod early_error;
mod input;
mod parallel;
mod request;

use futures_util::future::BoxFuture;
use serde_json::Value;

use crate::sdk::{
    call::CallOptions,
    error::ModelError,
    http::post_json,
    model::{body_of, decoded_body, LanguageModel, ModelStream},
};

const API_URL: &str = "https://api.openai.com/v1";

pub(crate) struct OpenAiResponsesModel {
    client: reqwest::Client,
    url: String,
    api_key: String,
    model: String,
}

impl OpenAiResponsesModel {
    pub(crate) fn new(client: reqwest::Client, base_url: Option<&str>, api_key: &str, model: &str) -> Self {
        let base = base_url.unwrap_or(API_URL).trim_end_matches('/');
        Self {
            client,
            url: format!("{base}/responses"),
            api_key: api_key.to_owned(),
            model: model.to_owned(),
        }
    }
}

pub(crate) fn error_message(body: &Value) -> Option<String> {
    let error = body.get("error")?;
    let text_or_null = |name: &str| error.get(name).map_or(true, |value| value.is_null() || value.is_string());
    let code_fine = error
        .get("code")
        .map_or(true, |code| code.is_null() || code.is_string() || code.is_number());
    if !text_or_null("type") || !code_fine {
        return None;
    }
    Some(error.get("message")?.as_str()?.to_owned())
}

/// The request as JSON text, for a client that has to adjust it first (ChatGPT sign-in).
pub(crate) fn request_text(model: &str, options: &CallOptions) -> Result<(String, Vec<Value>), ModelError> {
    let (body, warnings) = request::build(model, options)?;
    let text = serde_json::to_string(&body)
        .map_err(|error| ModelError::Unsupported(format!("The request couldn't be built: {error}")))?;
    Ok((text, warnings))
}

/// Reads an accepted response as a stream, with the same checks as a plain call.
pub(crate) async fn decoded_response(
    response: reqwest::Response,
    options: &CallOptions,
    warnings: Vec<Value>,
    secret: &str,
) -> Result<ModelStream, ModelError> {
    let body = early_error::throw_if_stream_error_before_output(body_of(response), secret).await?;
    let tools = options.tools.iter().map(|tool| tool.name.clone()).collect();
    let stored = request::store_option(options).unwrap_or(false);
    let decoder = decoder::ResponsesDecoder::new(warnings, tools, stored);
    Ok(decoded_body(body, decoder, secret))
}

/// `expandParallelToolCall`, for a client reading a whole answer.
pub(crate) fn expanded_tool_call(
    tool_call_id: &str,
    tool_name: &str,
    input: &str,
    tools: &[String],
    item_id: &str,
) -> Option<Vec<crate::sdk::stream::StreamPart>> {
    parallel::expand_parallel_tool_call(tool_call_id, tool_name, input, tools, item_id)
}

impl LanguageModel for OpenAiResponsesModel {
    fn stream(&self, options: CallOptions) -> BoxFuture<'_, Result<ModelStream, ModelError>> {
        Box::pin(async move {
            let (body, warnings) = request::build(&self.model, &options)?;
            let headers = [("authorization", format!("Bearer {}", self.api_key))];
            let response =
                post_json(&self.client, &self.url, &headers, &body, &self.api_key, error_message).await?;
            decoded_response(response, &options, warnings, &self.api_key).await
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calls_go_to_the_responses_path() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::new();
        assert_eq!(OpenAiResponsesModel::new(client.clone(), None, "k", "m").url, "https://api.openai.com/v1/responses");
        assert_eq!(OpenAiResponsesModel::new(client, Some("http://local:1/v1/"), "k", "m").url, "http://local:1/v1/responses");
    }
}
