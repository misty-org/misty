//! The `X-Misty-Models` header: this device's model choices and provider keys, as
//! base64url (no padding) of UTF-8 JSON. Built here and only here; the renderer never
//! sees it and the value is never logged.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Map, Value};

pub const HEADER: &str = "x-misty-models";

/// The largest header the server accepts.
pub const MAX_HEADER_BYTES: usize = 16 * 1024;

/// Every provider a key can be saved for.
pub const PROVIDERS: [&str; 10] = [
    "openai",
    "anthropic",
    "google",
    "openrouter",
    "gateway",
    "nvidia",
    "ollama",
    "openai-compatible",
    "elevenlabs",
    "soniox",
];

/// Each role the header carries and the device setting (section `models`) naming its model.
pub const ROLES: [(&str, &str); 5] = [
    ("agent", "agent_model"),
    ("fast", "fast_model"),
    ("embedding", "embedding_model"),
    ("transcription", "transcription_model"),
    ("speech", "speech_model"),
];

const REASONING: [&str; 6] = ["none", "minimal", "low", "medium", "high", "xhigh"];
const DEFAULT_REASONING: &str = "low";
const MAX_MODEL_ID: usize = 200;

pub fn is_provider(id: &str) -> bool {
    PROVIDERS.contains(&id)
}

/// The device setting that holds a provider's base URL, for providers that take one.
pub fn base_url_setting(provider: &str) -> Option<&'static str> {
    match provider {
        "ollama" => Some("ollama_base_url"),
        "openai-compatible" => Some("openai_compatible_base_url"),
        _ => None,
    }
}

/// The provider a `<providerID>/<model>` ID names, when it names a known one.
fn provider_of(model: &str) -> Option<&'static str> {
    let (provider, rest) = model.split_once('/')?;
    if rest.trim().is_empty() {
        return None;
    }
    PROVIDERS.iter().copied().find(|known| *known == provider)
}

fn text<'a>(settings: &'a Value, key: &str) -> Option<&'a str> {
    settings
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn base_url(settings: &Value, provider: &str) -> Option<String> {
    let raw = text(settings, base_url_setting(provider)?)?;
    let url = url::Url::parse(raw).ok()?;
    let usable = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none();
    usable.then(|| raw.trim_end_matches('/').to_owned())
}

/// The header value for this device's `models` settings section, reading each referenced
/// provider's key through `key`. None when no agent model has a usable provider, or when
/// the result would be larger than the server accepts.
pub fn encode(settings: &Value, key: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let mut providers = Map::new();
    let mut models = Map::new();
    for (role, setting) in ROLES {
        let Some(model) = text(settings, setting).filter(|model| model.len() <= MAX_MODEL_ID)
        else {
            continue;
        };
        let Some(provider) = provider_of(model) else {
            continue;
        };
        if !providers.contains_key(provider) {
            let api_key = key(provider)
                .map(|key| key.trim().to_owned())
                .filter(|key| !key.is_empty());
            let base = base_url(settings, provider);
            // Ollama needs no key; an OpenAI-compatible server needs its address; the rest
            // need a key.
            let usable = match provider {
                "ollama" => base.is_some(),
                "openai-compatible" => base.is_some(),
                _ => api_key.is_some(),
            };
            if !usable {
                continue;
            }
            let mut entry = Map::new();
            if let Some(api_key) = api_key {
                entry.insert("apiKey".into(), Value::String(api_key));
            }
            if let Some(base) = base {
                entry.insert("baseURL".into(), Value::String(base));
            }
            providers.insert(provider.to_owned(), Value::Object(entry));
        }
        models.insert(role.to_owned(), Value::String(model.to_owned()));
    }
    if !models.contains_key("agent") {
        return None;
    }
    let reasoning = text(settings, "reasoning")
        .filter(|value| REASONING.contains(value))
        .unwrap_or(DEFAULT_REASONING);
    let document = json!({
        "version": 1,
        "providers": providers,
        "models": models,
        "reasoning": reasoning,
    });
    let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&document).ok()?);
    (encoded.len() <= MAX_HEADER_BYTES).then_some(encoded)
}
