//! Embeddings. `embed_many` is ported from the `ai` package's `embedMany`.
use std::sync::Arc;

use futures_util::future::{try_join_all, BoxFuture};
use serde_json::Value;

use super::{
    google_embedding::GoogleEmbeddingModel,
    openai_embedding::{GatewayEmbeddingModel, OpenAiStyleEmbeddingModel},
};
use crate::model_calls::error::ModelError;
use crate::model_calls::generate::{with_retries, DEFAULT_MAX_RETRIES};
use crate::model_calls::prompt::ProviderOptions;
use crate::model_calls::providers::gateway;
use crate::model_calls::route::{resolve_target, ModelRoute, ProviderId};

const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

/// What one call gives back.
#[derive(Clone, Debug, Default)]
pub struct EmbedResponse {
    pub embeddings: Vec<Vec<f64>>,
    /// Missing when the provider doesn't report it.
    pub tokens: Option<u64>,
    pub warnings: Vec<Value>,
    pub provider_metadata: Option<Value>,
}

pub trait EmbeddingModel: Send + Sync {
    /// The most values one call may hold. Longer lists are split.
    fn max_embeddings_per_call(&self) -> usize;
    fn do_embed<'a>(
        &'a self,
        values: &'a [String],
        provider_options: Option<&'a ProviderOptions>,
    ) -> BoxFuture<'a, Result<EmbedResponse, ModelError>>;
}

/// What `embed_many` gives back, with `tokens` missing if any call didn't report them.
#[derive(Clone, Debug, Default)]
pub struct EmbedManyResult {
    pub embeddings: Vec<Vec<f64>>,
    pub tokens: Option<u64>,
    pub warnings: Vec<Value>,
    pub provider_metadata: Option<Value>,
}

/// One provider's metadata, merged over what the earlier calls gave.
fn merge_metadata(into: &mut Option<Value>, more: Value) {
    let Some(Value::Object(kept)) = into else {
        *into = Some(more);
        return;
    };
    let Value::Object(more) = more else {
        return;
    };
    for (provider, fields) in more {
        match (kept.get_mut(&provider), fields) {
            (Some(Value::Object(existing)), Value::Object(fields)) => existing.extend(fields),
            (_, fields) => {
                kept.insert(provider, fields);
            }
        }
    }
}

/// Embeds many values at once, split into as many parallel calls as the model needs. `max_retries`
/// of `None` is the SDK's default of 2.
pub async fn embed_many(
    model: &dyn EmbeddingModel,
    values: &[String],
    provider_options: Option<&ProviderOptions>,
    max_retries: Option<u32>,
) -> Result<EmbedManyResult, ModelError> {
    let retries = max_retries.unwrap_or(DEFAULT_MAX_RETRIES);
    let calls = values.chunks(model.max_embeddings_per_call().max(1)).map(|chunk| {
        with_retries(retries, move || model.do_embed(chunk, provider_options))
    });
    let responses = try_join_all(calls).await?;
    let mut result = EmbedManyResult { tokens: Some(0), ..EmbedManyResult::default() };
    for response in responses {
        result.embeddings.extend(response.embeddings);
        result.warnings.extend(response.warnings);
        result.tokens = result.tokens.zip(response.tokens).map(|(sum, tokens)| sum + tokens);
        if let Some(metadata) = response.provider_metadata {
            merge_metadata(&mut result.provider_metadata, metadata);
        }
    }
    Ok(result)
}

/// `resolveEmbeddingModel`: one embedding model on the route's key.
pub fn resolve_embedding_model(
    model_id: &str,
    route: &ModelRoute,
    client: &reqwest::Client,
) -> Result<Arc<dyn EmbeddingModel>, ModelError> {
    let target = resolve_target(model_id, route)?;
    let style = |base: String, compatible_name: Option<String>| -> Arc<dyn EmbeddingModel> {
        Arc::new(OpenAiStyleEmbeddingModel {
            client: client.clone(),
            url: format!("{}/embeddings", base.trim_end_matches('/')),
            api_key: target.api_key.clone(),
            model: target.model.clone(),
            compatible_name,
        })
    };
    match target.provider {
        ProviderId::Openai => Ok(style(target.base_url.clone().unwrap_or_else(|| OPENAI_BASE_URL.to_owned()), None)),
        ProviderId::Google => Ok(Arc::new(GoogleEmbeddingModel::new(
            client.clone(),
            target.base_url.as_deref(),
            &target.api_key,
            &target.model,
        ))),
        ProviderId::Gateway => Ok(Arc::new(GatewayEmbeddingModel {
            client: client.clone(),
            url: format!("{}/embedding-model", target.base_url.as_deref().unwrap_or(gateway::DEFAULT_BASE_URL)),
            api_key: target.api_key.clone(),
            model: target.model.clone(),
        })),
        ProviderId::Openrouter | ProviderId::Nvidia | ProviderId::Ollama | ProviderId::OllamaCloud | ProviderId::OpenaiCompatible => {
            let base = target
                .base_url
                .clone()
                .or_else(|| target.provider.default_compatible_base().map(str::to_owned))
                .unwrap_or_default();
            Ok(style(base, Some(target.provider.as_str().to_owned())))
        }
        ProviderId::Anthropic | ProviderId::Chatgpt | ProviderId::Elevenlabs | ProviderId::Soniox => {
            Err(ModelError::unsupported_model("This provider has no embedding models."))
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn metadata_merges_by_provider() {
        let mut kept = None;
        merge_metadata(&mut kept, json!({ "a": { "x": 1 } }));
        merge_metadata(&mut kept, json!({ "a": { "y": 2 }, "b": { "z": 3 } }));
        assert_eq!(kept.unwrap(), json!({ "a": { "x": 1, "y": 2 }, "b": { "z": 3 } }));
    }
}
