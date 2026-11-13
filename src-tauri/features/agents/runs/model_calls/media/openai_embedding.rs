//! Embeddings from OpenAI, the compatible servers and the Gateway. Ported from `@ai-sdk/openai`,
//! `@ai-sdk/openai-compatible` and `@ai-sdk/gateway`.
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Map, Number, Value};

use super::{
    embedding::{EmbedResponse, EmbeddingModel},
    http::{openai_error_message, read_json},
};
use crate::model_calls::error::ModelError;
use crate::model_calls::http::{post_body, post_json};
use crate::model_calls::prompt::ProviderOptions;
use crate::model_calls::providers::gateway::{auth_headers, checked};

#[derive(Deserialize)]
struct OpenAiEmbedding {
    embedding: Vec<f64>,
}

#[derive(Deserialize)]
struct OpenAiUsage {
    prompt_tokens: u64,
}

#[derive(Deserialize)]
struct OpenAiEmbeddings {
    data: Vec<OpenAiEmbedding>,
    #[serde(default)]
    usage: Option<OpenAiUsage>,
    #[serde(default, rename = "providerMetadata")]
    provider_metadata: Option<Value>,
}

#[derive(Default, Deserialize)]
struct DimensionOptions {
    dimensions: Option<Number>,
    user: Option<String>,
}

impl DimensionOptions {
    fn over(mut self, later: Self) -> Self {
        self.dimensions = later.dimensions.or(self.dimensions);
        self.user = later.user.or(self.user);
        self
    }
}

fn dimension_options(options: Option<&ProviderOptions>, name: &str) -> Result<Option<DimensionOptions>, ModelError> {
    let Some(value) = options.and_then(|options| options.get(name)).filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    serde_json::from_value(value.clone())
        .map(Some)
        .map_err(|_| ModelError::Unsupported(format!("invalid {name} provider options")))
}

/// `/[_-]([a-z])/g` to the letter in upper case.
fn to_camel_case(name: &str) -> String {
    let mut camel = String::with_capacity(name.len());
    let mut characters = name.chars().peekable();
    while let Some(character) = characters.next() {
        match characters.peek() {
            Some(next) if matches!(character, '_' | '-') && next.is_ascii_lowercase() => {
                camel.push(next.to_ascii_uppercase());
                characters.next();
            }
            _ => camel.push(character),
        }
    }
    camel
}

/// Chat-completions style embeddings, which OpenAI and the compatible servers share.
pub(super) struct OpenAiStyleEmbeddingModel {
    pub(super) client: reqwest::Client,
    pub(super) url: String,
    pub(super) api_key: String,
    pub(super) model: String,
    /// `None` for OpenAI itself, or the compatible provider's name.
    pub(super) compatible_name: Option<String>,
}

impl OpenAiStyleEmbeddingModel {
    fn options(&self, options: Option<&ProviderOptions>, warnings: &mut Vec<Value>) -> Result<DimensionOptions, ModelError> {
        let Some(name) = &self.compatible_name else {
            return Ok(dimension_options(options, "openai")?.unwrap_or_default());
        };
        let deprecated = dimension_options(options, "openai-compatible")?;
        if deprecated.is_some() {
            warnings.push(json!({
                "type": "deprecated",
                "setting": "providerOptions key 'openai-compatible'",
                "message": "Use 'openaiCompatible' instead.",
            }));
        }
        let camel = to_camel_case(name);
        if camel != *name && options.and_then(|options| options.get(name)).is_some_and(|value| !value.is_null()) {
            warnings.push(json!({
                "type": "deprecated",
                "setting": format!("providerOptions key '{name}'"),
                "message": format!("Use '{camel}' instead."),
            }));
        }
        let merged = deprecated
            .unwrap_or_default()
            .over(dimension_options(options, "openaiCompatible")?.unwrap_or_default())
            .over(dimension_options(options, name)?.unwrap_or_default());
        Ok(merged)
    }
}

impl EmbeddingModel for OpenAiStyleEmbeddingModel {
    fn max_embeddings_per_call(&self) -> usize {
        2048
    }

    fn do_embed<'a>(
        &'a self,
        values: &'a [String],
        provider_options: Option<&'a ProviderOptions>,
    ) -> BoxFuture<'a, Result<EmbedResponse, ModelError>> {
        Box::pin(async move {
            let mut warnings = Vec::new();
            let options = self.options(provider_options, &mut warnings)?;
            let mut body = Map::new();
            body.insert("model".into(), json!(self.model));
            body.insert("input".into(), json!(values));
            body.insert("encoding_format".into(), json!("float"));
            if let Some(dimensions) = options.dimensions {
                body.insert("dimensions".into(), Value::Number(dimensions));
            }
            if let Some(user) = options.user {
                body.insert("user".into(), json!(user));
            }
            let mut headers = Vec::new();
            // A local server may run without a key.
            if !self.api_key.is_empty() {
                headers.push(("authorization", format!("Bearer {}", self.api_key)));
            }
            let response =
                post_json(&self.client, &self.url, &headers, &body, &self.api_key, openai_error_message).await?;
            let parsed: OpenAiEmbeddings = read_json(response).await?;
            Ok(EmbedResponse {
                embeddings: parsed.data.into_iter().map(|item| item.embedding).collect(),
                tokens: parsed.usage.map(|usage| usage.prompt_tokens),
                warnings,
                provider_metadata: parsed.provider_metadata,
            })
        })
    }
}

#[derive(Deserialize)]
struct GatewayUsage {
    tokens: u64,
}

#[derive(Deserialize)]
struct GatewayEmbeddings {
    embeddings: Vec<Vec<f64>>,
    #[serde(default)]
    usage: Option<GatewayUsage>,
    #[serde(default)]
    warnings: Vec<Value>,
    #[serde(default, rename = "providerMetadata")]
    provider_metadata: Option<Value>,
}

pub(super) struct GatewayEmbeddingModel {
    pub(super) client: reqwest::Client,
    pub(super) url: String,
    pub(super) api_key: String,
    pub(super) model: String,
}

impl EmbeddingModel for GatewayEmbeddingModel {
    fn max_embeddings_per_call(&self) -> usize {
        2048
    }

    fn do_embed<'a>(
        &'a self,
        values: &'a [String],
        provider_options: Option<&'a ProviderOptions>,
    ) -> BoxFuture<'a, Result<EmbedResponse, ModelError>> {
        Box::pin(async move {
            let mut body = json!({ "values": values });
            if let Some(options) = provider_options {
                body["providerOptions"] = Value::Object(options.clone());
            }
            let bytes = serde_json::to_vec(&body)
                .map_err(|error| ModelError::Unsupported(format!("The request couldn't be built: {error}")))?;
            let mut headers = auth_headers(&self.api_key);
            headers.push(("ai-embedding-model-specification-version", "4".to_owned()));
            headers.push(("ai-model-id", self.model.clone()));
            let response = post_body(&self.client, &self.url, &headers, "application/json", bytes, &self.api_key).await?;
            let response = checked(response, &self.api_key).await?;
            let parsed: GatewayEmbeddings = read_json(response).await?;
            Ok(EmbedResponse {
                embeddings: parsed.embeddings,
                tokens: parsed.usage.map(|usage| usage.tokens),
                warnings: parsed.warnings,
                provider_metadata: parsed.provider_metadata,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_names_become_camel_case() {
        assert_eq!(to_camel_case("openai-compatible"), "openaiCompatible");
        assert_eq!(to_camel_case("nvidia"), "nvidia");
        assert_eq!(to_camel_case("a_b-C"), "aB-C");
    }
}
