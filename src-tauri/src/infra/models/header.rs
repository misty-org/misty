//! This device's model choices and provider keys, and its web search key, as the JSON the
//! agent runtime on this computer takes (docs/agents/runtime.md). Built here and only here;
//! the renderer never sees it, it is never logged, and it never leaves the computer.
use serde_json::{json, Map, Value};

/// Every provider a key can be saved for.
pub const PROVIDERS: [&str; 12] = [
    "openai",
    "anthropic",
    "google",
    "openrouter",
    "gateway",
    "nvidia",
    "ollama",
    "ollama-cloud",
    "openai-compatible",
    // Signed in, not keyed: its short-lived access token is put in the runtime's document only.
    "chatgpt",
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

/// The web search providers a key can be saved for. The runtime runs `web.search` on the one
/// the device setting `search_provider` names (Decodo when unset), with its saved key.
pub const SEARCH_PROVIDERS: [&str; 2] = ["decodo", "serper"];

const REASONING: [&str; 6] = ["none", "minimal", "low", "medium", "high", "xhigh"];
const DEFAULT_REASONING: &str = "low";
const MAX_MODEL_ID: usize = 200;

pub fn is_provider(id: &str) -> bool {
    PROVIDERS.contains(&id)
}

/// The search provider and key for `web.search`, when the chosen provider has a key.
fn search(settings: &Value, key: &dyn Fn(&str) -> Option<String>) -> Option<Value> {
    let provider = text(settings, "search_provider")
        .filter(|provider| SEARCH_PROVIDERS.contains(provider))
        .unwrap_or(SEARCH_PROVIDERS[0]);
    let api_key = key(provider)
        .map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty())?;
    Some(json!({ "provider": provider, "apiKey": api_key }))
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

/// This device's model choices and the keys they need. None when no agent model has a usable
/// provider and there's no Soniox key for the live relay.
pub fn document(settings: &Value, key: &dyn Fn(&str) -> Option<String>) -> Option<Value> {
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
    // The live relay always streams to Soniox, whichever transcription model is chosen, and
    // subtitles and captures don't need an agent model.
    if !providers.contains_key("soniox") {
        let api_key = key("soniox")
            .map(|key| key.trim().to_owned())
            .filter(|key| !key.is_empty());
        if let Some(api_key) = api_key {
            providers.insert("soniox".to_owned(), json!({ "apiKey": api_key }));
        }
    }
    if !models.contains_key("agent") && !providers.contains_key("soniox") {
        return None;
    }
    let reasoning = text(settings, "reasoning")
        .filter(|value| REASONING.contains(value))
        .unwrap_or(DEFAULT_REASONING);
    let mut document = json!({
        "version": 1,
        "providers": providers,
        "models": models,
        "reasoning": reasoning,
    });
    if let Some(search) = search(settings, key) {
        document["search"] = search;
    }
    Some(document)
}
