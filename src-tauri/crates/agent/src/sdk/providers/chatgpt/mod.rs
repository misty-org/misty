//! Sign in with ChatGPT's plan usage for open-source apps
//! (developers.openai.com/siwc/token-sharing-open-source). The desktop signs in and refreshes the
//! tokens, and this client gets only a short-lived access token and calls the Responses API with it
//! as the bearer. Language models only. Ported from `chatgpt-provider.ts`.
//!
//! The preview accepts a narrow Responses request: `store: false` and `stream: true` on every call,
//! no system-role input items (their text goes into `instructions`), no `previous_response_id`, and
//! none of the fields in `body.rs`. Every request is reshaped there, last thing before it's sent, so
//! nothing the client or a caller adds can slip through.
mod body;
mod whole_answer;

use futures_util::{future::BoxFuture, stream};
use serde_json::{json, Value};

use crate::sdk::{
    call::CallOptions,
    error::{retryable_status, ModelError},
    generate::{collect_turn, CollectedTurn},
    http::post_json,
    model::{LanguageModel, ModelStream},
    providers::{
        openai_responses::{decoded_response, error_message, request_text},
        ordered::Ordered,
    },
};

/// The address is fixed: a base URL in the person's settings doesn't apply to this provider.
pub(crate) const API_URL: &str = "https://api.openai.com/v1";

pub(crate) struct ChatGptModel {
    client: reqwest::Client,
    url: String,
    token: String,
    model: String,
}

/// `chatgptLanguageModel`'s adjustments to a call's options.
pub(crate) fn prepared_options(mut options: CallOptions) -> CallOptions {
    options.max_output_tokens = None;
    options.temperature = None;
    options.top_p = None;
    let provider_options = options.provider_options.get_or_insert_with(Default::default);
    let openai = provider_options.entry("openai").or_insert_with(|| json!({}));
    if let Value::Object(fields) = openai {
        fields.insert("store".into(), Value::Bool(false));
    } else {
        *openai = json!({ "store": false });
    }
    for tool in &mut options.tools {
        tool.strict.get_or_insert(false);
    }
    options
}

impl ChatGptModel {
    pub(crate) fn new(client: reqwest::Client, base_url: &str, token: &str, model: &str) -> Self {
        Self {
            client,
            url: format!("{}/responses", base_url.trim_end_matches('/')),
            token: token.to_owned(),
            model: model.to_owned(),
        }
    }

    /// Sends the call in the shape the preview takes, always asking for a stream.
    async fn send(&self, options: &CallOptions) -> Result<(reqwest::Response, Vec<Value>), ModelError> {
        let (text, warnings) = request_text(&self.model, options)?;
        let tree = Ordered::from_text(&text)
            .map_err(|error| ModelError::Unsupported(format!("The request couldn't be built: {error}")))?;
        let body = body::chatgpt_body(tree);
        let headers = [
            ("authorization", format!("Bearer {}", self.token)),
            ("accept", "text/event-stream".to_owned()),
        ];
        let response = post_json(&self.client, &self.url, &headers, &body, &self.token, error_message).await?;
        Ok((response, warnings))
    }
}

impl LanguageModel for ChatGptModel {
    fn stream(&self, options: CallOptions) -> BoxFuture<'_, Result<ModelStream, ModelError>> {
        Box::pin(async move {
            let (response, warnings) = self.send(&options).await?;
            decoded_response(response, &options, warnings, &self.token).await
        })
    }

    /// Streams even so, because the preview does nothing else, and answers from the final event.
    fn generate(&self, options: CallOptions) -> BoxFuture<'_, Result<CollectedTurn, ModelError>> {
        Box::pin(async move {
            let (response, warnings) = self.send(&options).await?;
            let status = response.status().as_u16();
            let text = response.text().await.map_err(|_| ModelError::Api {
                status,
                message: "Failed to process successful response".into(),
                retryable: retryable_status(status),
                retry_after_ms: None,
            })?;
            let answer = whole_answer::stream_to_response(&text)
                .map_err(|(status, _code, message)| whole_answer::failed(status, crate::sdk::error::scrub(&message, &self.token)))?;
            if let Some(error) = answer.get("error").filter(|error| !error.is_null()) {
                let message = error.get("message").and_then(Value::as_str).unwrap_or_default();
                return Err(ModelError::Api {
                    status: 400,
                    message: crate::sdk::error::scrub(message, &self.token),
                    retryable: false,
                    retry_after_ms: None,
                });
            }
            if answer.get("output").map_or(true, Value::is_null) {
                let detail = answer.pointer("/incomplete_details/reason").and_then(Value::as_str);
                let message = match detail {
                    Some(detail) => format!("Responses API returned no output ({detail})"),
                    None => "Responses API returned no output".to_owned(),
                };
                return Err(ModelError::Api { status: 500, message, retryable: false, retry_after_ms: None });
            }
            let tools: Vec<String> = options.tools.iter().map(|tool| tool.name.clone()).collect();
            let parts = whole_answer::response_parts(&answer, &tools);
            let mut turn = collect_turn(Box::pin(stream::iter(parts))).await;
            turn.warnings = warnings;
            turn.response_id = answer.get("id").and_then(Value::as_str).map(str::to_owned);
            turn.response_model_id = answer.get("model").and_then(Value::as_str).map(str::to_owned);
            Ok(turn)
        })
    }
}
