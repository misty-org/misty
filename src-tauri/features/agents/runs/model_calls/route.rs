//! Which provider, model and key a call uses. Models run on the device's own key for the model's
//! provider, and only on that key.
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::{
    call::CallOptions,
    error::ModelError,
    model::LanguageModel,
    prompt::{Message, OutputItem, ToolOutput, ToolResultPart, UserPart},
    providers::{
        anthropic::AnthropicModel,
        gateway::{self, GatewayModel},
        google::{self, GoogleModel},
        openai_compatible::OpenAiCompatibleModel,
        openai_responses::OpenAiResponsesModel,
    },
};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderId {
    Openai,
    Anthropic,
    Google,
    Openrouter,
    Gateway,
    Nvidia,
    Ollama,
    OllamaCloud,
    OpenaiCompatible,
    Elevenlabs,
    Soniox,
}

impl ProviderId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Anthropic => "anthropic",
            Self::Google => "google",
            Self::Openrouter => "openrouter",
            Self::Gateway => "gateway",
            Self::Nvidia => "nvidia",
            Self::Ollama => "ollama",
            Self::OllamaCloud => "ollama-cloud",
            Self::OpenaiCompatible => "openai-compatible",
            Self::Elevenlabs => "elevenlabs",
            Self::Soniox => "soniox",
        }
    }

    fn from_prefix(prefix: &str) -> Option<Self> {
        Some(match prefix {
            "openai" => Self::Openai,
            "anthropic" => Self::Anthropic,
            // Older prefixes kept so existing model IDs keep working.
            "google" | "gemini" => Self::Google,
            "openrouter" => Self::Openrouter,
            "gateway" => Self::Gateway,
            "nvidia" | "nim" => Self::Nvidia,
            "ollama" => Self::Ollama,
            "ollama-cloud" => Self::OllamaCloud,
            "openai-compatible" => Self::OpenaiCompatible,
            "elevenlabs" => Self::Elevenlabs,
            "soniox" => Self::Soniox,
            _ => return None,
        })
    }

    /// Providers that run without a key: a local server.
    fn key_optional(self) -> bool {
        matches!(self, Self::Ollama | Self::OpenaiCompatible)
    }

    /// Where a chat-completions provider lives unless the person's settings say otherwise.
    pub(crate) fn default_compatible_base(self) -> Option<&'static str> {
        match self {
            Self::Openrouter => Some("https://openrouter.ai/api/v1"),
            Self::Nvidia => Some("https://integrate.api.nvidia.com/v1"),
            Self::Ollama => Some("http://127.0.0.1:11434/v1"),
            Self::OllamaCloud => Some("https://ollama.com/v1"),
            _ => None,
        }
    }
}

/// `<provider>/<model as that provider names it>`, with the old aliases resolved.
pub fn parse_model_id(model_id: &str) -> Result<(ProviderId, &str), ModelError> {
    let invalid = || ModelError::unsupported_model("Use a model ID of the form provider/model.");
    let (prefix, model) = model_id.split_once('/').ok_or_else(invalid)?;
    let provider = ProviderId::from_prefix(prefix).ok_or_else(invalid)?;
    if model.is_empty() || model.chars().any(char::is_whitespace) || model_id.len() > 200 {
        return Err(invalid());
    }
    Ok((provider, model))
}

/// The device's key for one provider. Its base URL may name a server on the person's own computer
/// or network, such as a local Ollama. It deliberately has no `Debug`, which could print the key.
#[derive(Clone, Deserialize)]
pub struct Credential {
    pub provider: ProviderId,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    #[serde(default, rename = "baseURL")]
    pub base_url: Option<String>,
}

/// The device's key for a model, and how hard it should think.
#[derive(Clone, Deserialize)]
pub struct ModelRoute {
    #[serde(default)]
    pub reasoning: Option<String>,
    pub credential: Credential,
}

fn normalized_base_url(value: Option<&str>) -> Result<Option<String>, ModelError> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let url = reqwest::Url::parse(value)
        .map_err(|_| ModelError::bad_base_url("The model's base URL isn't a valid URL."))?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return Err(ModelError::bad_base_url("The model's base URL must be an http(s) address."));
    }
    Ok(Some(url.as_str().trim_end_matches('/').to_owned()))
}

/// Moves screenshots out of tool results. Chat completions carry tool results as text only, so a
/// screenshot there would reach the model as base64 text. They move to a user message right after
/// the results, where they are images, and the results say so.
pub(crate) fn images_out_of_tool_results(prompt: Vec<Message>) -> Vec<Message> {
    let mut moved = Vec::with_capacity(prompt.len());
    for message in prompt {
        let Message::Tool { content, provider_options } = message else {
            moved.push(message);
            continue;
        };
        let mut images = Vec::new();
        let content = content
            .into_iter()
            .map(|part| screenshots_taken_from(part, &mut images))
            .collect();
        moved.push(Message::Tool { content, provider_options });
        if !images.is_empty() {
            let mut parts = vec![UserPart::Text {
                text: "Screenshots from the tool results above:".into(),
            }];
            parts.append(&mut images);
            moved.push(Message::User { content: parts, provider_options: None });
        }
    }
    moved
}

fn screenshots_taken_from(part: ToolResultPart, images: &mut Vec<UserPart>) -> ToolResultPart {
    let ToolOutput::Content { value } = &part.output else {
        return part;
    };
    let is_image = |item: &&OutputItem| {
        matches!(item, OutputItem::File { media_type, .. } if media_type.starts_with("image"))
    };
    let shots = value.iter().filter(is_image).count();
    if shots == 0 {
        return part;
    }
    for item in value.iter().filter(is_image) {
        if let OutputItem::File { data, media_type } = item {
            images.push(UserPart::File { data: data.clone(), media_type: media_type.clone() });
        }
    }
    let text = value
        .iter()
        .filter_map(|item| match item {
            OutputItem::Text { text } => Some(text.as_str()),
            OutputItem::File { .. } => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    let plural = if shots == 1 { "" } else { "s" };
    ToolResultPart {
        output: ToolOutput::Text {
            value: format!("{text}\n({shots} screenshot{plural} in the next message)"),
        },
        ..part
    }
}

/// Gateway routing options mean nothing to any other provider.
fn without_gateway_options(options: &mut CallOptions) {
    if let Some(provider_options) = &mut options.provider_options {
        provider_options.remove("gateway");
    }
}

/// Gateway model lists name models as the Gateway does, without a `gateway/` prefix.
fn gateway_options(options: &mut CallOptions) {
    let models = options
        .provider_options
        .as_mut()
        .and_then(|provider_options| provider_options.get_mut("gateway"))
        .and_then(|routing| routing.get_mut("models"))
        .and_then(serde_json::Value::as_array_mut);
    for model in models.into_iter().flatten() {
        if let Some(name) = model.as_str().and_then(|name| name.strip_prefix("gateway/")) {
            *model = name.into();
        }
    }
}

/// The Gateway names `claude-haiku-5.5`, and Anthropic's own API names `claude-haiku-5-5`.
fn anthropic_model_name(model: &str) -> String {
    model.replace('.', "-")
}

/// Which provider, model name and key one call uses.
pub(crate) struct Target {
    pub(crate) provider: ProviderId,
    pub(crate) model: String,
    pub(crate) api_key: String,
    pub(crate) base_url: Option<String>,
}

/// `resolveTarget`, for every kind of model.
pub(crate) fn resolve_target(model_id: &str, route: &ModelRoute) -> Result<Target, ModelError> {
    let (provider, model) = parse_model_id(model_id)?;
    let credential = &route.credential;
    // A key is used only for its own provider.
    if credential.provider != provider {
        return Err(ModelError::key_needed());
    }
    let api_key = credential.api_key.trim().to_owned();
    if api_key.is_empty() && !provider.key_optional() {
        return Err(ModelError::key_needed());
    }
    let base_url = normalized_base_url(credential.base_url.as_deref())?;
    if provider == ProviderId::OpenaiCompatible && base_url.is_none() {
        return Err(ModelError::bad_base_url("An OpenAI-compatible model needs a base URL."));
    }
    Ok(Target { provider, model: model.to_owned(), api_key, base_url })
}

/// One call's model on the route's key, with the call's options adjusted for that provider.
pub fn resolve_model(
    model_id: &str,
    mut options: CallOptions,
    route: &ModelRoute,
    client: &reqwest::Client,
) -> Result<(Arc<dyn LanguageModel>, CallOptions), ModelError> {
    let Target { provider, model, api_key, base_url } = resolve_target(model_id, route)?;
    let model = model.as_str();
    options.reasoning = route.reasoning.clone().filter(|value| !value.is_empty()).or(options.reasoning);
    match provider {
        ProviderId::Openrouter
        | ProviderId::Nvidia
        | ProviderId::Ollama
        | ProviderId::OllamaCloud
        | ProviderId::OpenaiCompatible => {
            options.prompt = images_out_of_tool_results(options.prompt);
            // Only OpenRouter takes `reasoning_effort`. The others switch thinking their own way
            // and may refuse it.
            if provider != ProviderId::Openrouter {
                options.reasoning = None;
            }
            let base = base_url
                .or_else(|| provider.default_compatible_base().map(str::to_owned))
                .unwrap_or_default();
            Ok((
                Arc::new(OpenAiCompatibleModel::new(client.clone(), &base, &api_key, provider, model)),
                options,
            ))
        }
        ProviderId::Elevenlabs | ProviderId::Soniox => {
            Err(ModelError::unsupported_model("This provider has no language models."))
        }
        ProviderId::Google => {
            without_gateway_options(&mut options);
            let base = base_url.as_deref().unwrap_or(google::DEFAULT_BASE_URL);
            Ok((Arc::new(GoogleModel::new(client.clone(), base, &api_key, model)), options))
        }
        ProviderId::Gateway => {
            gateway_options(&mut options);
            let base = base_url.as_deref().unwrap_or(gateway::DEFAULT_BASE_URL);
            Ok((Arc::new(GatewayModel::new(client.clone(), base, &api_key, model)), options))
        }
        ProviderId::Openai => {
            without_gateway_options(&mut options);
            // Responses normalizes an omitted strict flag, which can turn optional capability
            // arguments into required fields. The admitted schema stays as it is unless the caller
            // asked for strict function calling.
            for tool in &mut options.tools {
                tool.strict.get_or_insert(false);
            }
            Ok((
                Arc::new(OpenAiResponsesModel::new(client.clone(), base_url.as_deref(), &api_key, model)),
                options,
            ))
        }
        ProviderId::Anthropic => {
            without_gateway_options(&mut options);
            Ok((
                Arc::new(AnthropicModel::new(client.clone(), base_url.as_deref(), &api_key, &anthropic_model_name(model))),
                options,
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client() -> reqwest::Client {
        let _ = rustls::crypto::ring::default_provider().install_default();
        reqwest::Client::new()
    }

    fn route(provider: ProviderId, api_key: &str, base_url: Option<&str>) -> ModelRoute {
        ModelRoute {
            reasoning: None,
            credential: Credential {
                provider,
                api_key: api_key.into(),
                base_url: base_url.map(str::to_owned),
            },
        }
    }

    fn code(error: ModelError) -> &'static str {
        match error {
            ModelError::Setup { code, .. } => code,
            other => panic!("expected a setup error, got {other}"),
        }
    }

    #[test]
    fn model_ids_resolve_aliases_and_refuse_nonsense() {
        assert_eq!(parse_model_id("nim/z-ai/glm").unwrap(), (ProviderId::Nvidia, "z-ai/glm"));
        assert_eq!(parse_model_id("gemini/flash").unwrap(), (ProviderId::Google, "flash"));
        for bad in ["plain", "nope/model", "nvidia/", "/model", "nvidia/has space"] {
            assert!(parse_model_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_key_only_works_for_its_own_provider() {
        let client = client();
        let wrong = resolve_model("nvidia/m", CallOptions::default(), &route(ProviderId::Openrouter, "key", None), &client);
        assert_eq!(code(wrong.err().unwrap()), "model_key_needed");
    }

    #[test]
    fn only_local_servers_may_skip_the_key() {
        let client = client();
        let missing = resolve_model("nvidia/m", CallOptions::default(), &route(ProviderId::Nvidia, " ", None), &client);
        assert_eq!(code(missing.err().unwrap()), "model_key_needed");
        assert!(resolve_model("ollama/m", CallOptions::default(), &route(ProviderId::Ollama, "", None), &client).is_ok());
    }

    #[test]
    fn base_urls_must_be_plain_http() {
        let client = client();
        for bad in ["file:///etc/passwd", "https://user:pw@example.com", "not a url"] {
            let result = resolve_model("ollama/m", CallOptions::default(), &route(ProviderId::Ollama, "", Some(bad)), &client);
            assert_eq!(code(result.err().unwrap()), "model_base_url_invalid", "{bad}");
        }
        let none = resolve_model("openai-compatible/m", CallOptions::default(), &route(ProviderId::OpenaiCompatible, "", None), &client);
        assert_eq!(code(none.err().unwrap()), "model_base_url_invalid");
    }

    #[test]
    fn credentials_cannot_be_printed() {
        // A compile-time promise made visible: `Credential` and `ModelRoute` don't implement Debug.
        fn no_debug<T>(_: &T) {}
        no_debug(&route(ProviderId::Nvidia, "secret-value", None));
    }
}
