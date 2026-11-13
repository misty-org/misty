//! Gemini embeddings. Ported from `GoogleEmbeddingModel` in `@ai-sdk/google`.
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use super::{embedding::{EmbedResponse, EmbeddingModel}, http::read_json};
use crate::model_calls::error::ModelError;
use crate::model_calls::http::post_json;
use crate::model_calls::prompt::ProviderOptions;
use crate::model_calls::providers::google::{error_message, DEFAULT_BASE_URL};

pub(super) struct GoogleEmbeddingModel {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
}

impl GoogleEmbeddingModel {
    pub(super) fn new(client: reqwest::Client, base_url: Option<&str>, api_key: &str, model: &str) -> Self {
        Self {
            client,
            base_url: base_url.unwrap_or(DEFAULT_BASE_URL).trim_end_matches('/').to_owned(),
            api_key: api_key.to_owned(),
            model: model.to_owned(),
        }
    }
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleEmbeddingOptions {
    output_dimensionality: Option<Value>,
    task_type: Option<String>,
    /// Non-text parts for each value, or `null` for a value that's only text.
    content: Option<Vec<Option<Vec<Value>>>>,
}

#[derive(Deserialize)]
struct Single {
    embedding: Values,
}

#[derive(Deserialize)]
struct Batch {
    embeddings: Vec<Values>,
}

#[derive(Deserialize)]
struct Values {
    values: Vec<f64>,
}

/// A value's parts. With other content, an empty value adds no text of its own.
fn parts_for(value: &str, content: Option<&Vec<Value>>) -> Vec<Value> {
    match content {
        Some(extra) => {
            let mut parts = Vec::with_capacity(extra.len() + 1);
            if !value.is_empty() {
                parts.push(json!({ "text": value }));
            }
            parts.extend(extra.iter().cloned());
            parts
        }
        None => vec![json!({ "text": value })],
    }
}

impl GoogleEmbeddingOptions {
    fn apply(&self, request: &mut Map<String, Value>) {
        if let Some(dimensions) = &self.output_dimensionality {
            request.insert("outputDimensionality".into(), dimensions.clone());
        }
        if let Some(task) = &self.task_type {
            request.insert("taskType".into(), json!(task));
        }
    }
}

impl EmbeddingModel for GoogleEmbeddingModel {
    fn max_embeddings_per_call(&self) -> usize {
        100
    }

    fn do_embed<'a>(
        &'a self,
        values: &'a [String],
        provider_options: Option<&'a ProviderOptions>,
    ) -> BoxFuture<'a, Result<EmbedResponse, ModelError>> {
        Box::pin(async move {
            let options: GoogleEmbeddingOptions = match provider_options.and_then(|all| all.get("google")).filter(|value| !value.is_null()) {
                Some(value) => serde_json::from_value(value.clone())
                    .map_err(|_| ModelError::Unsupported("invalid google provider options".into()))?,
                None => GoogleEmbeddingOptions::default(),
            };
            if let Some(content) = &options.content {
                if content.len() != values.len() {
                    return Err(ModelError::Unsupported(format!(
                        "The number of multimodal content entries ({}) must match the number of values ({}).",
                        content.len(),
                        values.len()
                    )));
                }
            }
            let content_at = |index: usize| options.content.as_ref().and_then(|content| content[index].as_ref());
            let headers = [("x-goog-api-key", self.api_key.clone())];
            let model_name = format!("models/{}", self.model);
            if let [value] = values {
                let mut body = Map::new();
                body.insert("model".into(), json!(model_name));
                body.insert("content".into(), json!({ "parts": parts_for(value, content_at(0)) }));
                options.apply(&mut body);
                let url = format!("{}/models/{}:embedContent", self.base_url, self.model);
                let response = post_json(&self.client, &url, &headers, &body, &self.api_key, error_message).await?;
                let parsed: Single = read_json(response).await?;
                return Ok(EmbedResponse { embeddings: vec![parsed.embedding.values], ..EmbedResponse::default() });
            }
            let requests: Vec<Value> = values
                .iter()
                .enumerate()
                .map(|(index, value)| {
                    let mut request = Map::new();
                    request.insert("model".into(), json!(model_name));
                    request.insert("content".into(), json!({ "role": "user", "parts": parts_for(value, content_at(index)) }));
                    options.apply(&mut request);
                    Value::Object(request)
                })
                .collect();
            let body = json!({ "requests": requests });
            let url = format!("{}/models/{}:batchEmbedContents", self.base_url, self.model);
            let response = post_json(&self.client, &url, &headers, &body, &self.api_key, error_message).await?;
            let parsed: Batch = read_json(response).await?;
            Ok(EmbedResponse {
                embeddings: parsed.embeddings.into_iter().map(|item| item.values).collect(),
                ..EmbedResponse::default()
            })
        })
    }
}
