//! Chat completions, as OpenRouter, NVIDIA, Ollama and other compatible servers speak them. Ported
//! from `@ai-sdk/openai-compatible`.
mod decoder;
mod request;

use futures_util::future::BoxFuture;
use serde_json::Value;

use crate::model_calls::call::CallOptions;
use crate::model_calls::error::ModelError;
use crate::model_calls::http::post_json;
use crate::model_calls::model::{decoded_stream, LanguageModel, ModelStream};
use crate::model_calls::route::ProviderId;

pub(crate) struct OpenAiCompatibleModel {
    client: reqwest::Client,
    url: String,
    api_key: String,
    provider: ProviderId,
    model: String,
}

impl OpenAiCompatibleModel {
    pub(crate) fn new(
        client: reqwest::Client,
        base_url: &str,
        api_key: &str,
        provider: ProviderId,
        model: &str,
    ) -> Self {
        Self {
            client,
            url: format!("{}/chat/completions", base_url.trim_end_matches('/')),
            api_key: api_key.to_owned(),
            provider,
            model: model.to_owned(),
        }
    }
}

fn error_message(body: &Value) -> Option<String> {
    Some(body.get("error")?.get("message")?.as_str()?.to_owned())
}

impl LanguageModel for OpenAiCompatibleModel {
    fn stream(&self, options: CallOptions) -> BoxFuture<'_, Result<ModelStream, ModelError>> {
        Box::pin(async move {
            let (body, warnings) = request::build(&self.model, &options, self.provider.as_str())?;
            let mut headers = Vec::new();
            // A local server may run without a key.
            if !self.api_key.is_empty() {
                headers.push(("authorization", format!("Bearer {}", self.api_key)));
            }
            let response =
                post_json(&self.client, &self.url, &headers, &body, &self.api_key, error_message).await?;
            let decoder = decoder::CompatibleDecoder::new(self.provider.as_str(), warnings);
            Ok(decoded_stream(response, decoder, &self.api_key))
        })
    }
}
