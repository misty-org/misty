//! The runtime on the person's desktop works on that device's model keys and
//! choices, and on its web search key. The app sets them whenever they change; they live only in this
//! process's memory and reach only their provider. Ported from `device-models.ts`.
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde_json::Value;

use crate::model_calls::{parse_model_id, Credential, ModelError, ModelRoute, ProviderId};

use super::{
    device::{DeviceModels, DeviceRole},
    text::js_len,
    web_search::{provider::SearchProviderId, search_step::DeviceSearch},
};

const PROVIDERS: [ProviderId; 12] = [
    ProviderId::Openai,
    ProviderId::Anthropic,
    ProviderId::Google,
    ProviderId::Openrouter,
    ProviderId::Gateway,
    ProviderId::Nvidia,
    ProviderId::Ollama,
    ProviderId::OllamaCloud,
    ProviderId::OpenaiCompatible,
    ProviderId::Chatgpt,
    ProviderId::Elevenlabs,
    ProviderId::Soniox,
];
const ROLES: [&str; 5] = ["agent", "fast", "embedding", "transcription", "speech"];
const REASONING: [&str; 6] = ["none", "minimal", "low", "medium", "high", "xhigh"];

fn role_name(role: DeviceRole) -> &'static str {
    match role {
        DeviceRole::Agent => "agent",
        DeviceRole::Fast => "fast",
        DeviceRole::Embedding => "embedding",
        DeviceRole::Transcription => "transcription",
        DeviceRole::Speech => "speech",
    }
}

/// One provider's saved key and address. No `Debug`, which could print the key.
#[derive(Clone)]
struct SavedProvider {
    id: ProviderId,
    api_key: Option<String>,
    base_url: Option<String>,
}

/// What the app gave. No `Debug`, for the same reason.
#[derive(Clone)]
struct Saved {
    providers: Vec<SavedProvider>,
    models: Vec<(String, String)>,
    reasoning: Option<String>,
    search: Option<DeviceSearch>,
    speech_voice: Option<String>,
}

/// The device's models, keys and search key.
#[derive(Default)]
pub struct DeviceModelStore(Mutex<Option<Saved>>);

fn bounded(value: &Value, min: usize, max: usize) -> Option<String> {
    let text = value.as_str()?;
    let length = js_len(text);
    (length >= min && length <= max).then(|| text.to_owned())
}

fn optional_bounded(value: Option<&Value>, max: usize) -> Option<Option<String>> {
    match value {
        None => Some(None),
        Some(value) => bounded(value, 0, max).map(Some),
    }
}

fn parse_provider(name: &str, value: &Value) -> Option<SavedProvider> {
    let id = PROVIDERS.into_iter().find(|id| id.as_str() == name)?;
    let fields = value.as_object()?;
    Some(SavedProvider {
        id,
        api_key: optional_bounded(fields.get("apiKey"), 8192)?,
        base_url: optional_bounded(fields.get("baseURL"), 2048)?,
    })
}

fn parse_search(value: &Value) -> Option<DeviceSearch> {
    let fields = value.as_object()?;
    let provider = match fields.get("provider")?.as_str()? {
        "decodo" => SearchProviderId::Decodo,
        "serper" => SearchProviderId::Serper,
        _ => return None,
    };
    Some(DeviceSearch { provider, api_key: bounded(fields.get("apiKey")?, 1, 8192)? })
}

fn parse_saved(value: &Value) -> Option<Saved> {
    let fields = value.as_object()?;
    if fields.get("version")?.as_u64()? != 1 || fields.get("version")?.as_f64()? != 1.0 {
        return None;
    }
    let providers = fields.get("providers")?.as_object()?.iter().map(|(name, saved)| parse_provider(name, saved)).collect::<Option<Vec<_>>>()?;
    let models = fields
        .get("models")?
        .as_object()?
        .iter()
        .map(|(role, model)| Some((ROLES.iter().find(|known| **known == role)?.to_string(), bounded(model, 3, 200)?)))
        .collect::<Option<Vec<_>>>()?;
    let reasoning = match fields.get("reasoning") {
        None => None,
        Some(value) => Some(value.as_str().filter(|effort| REASONING.contains(effort))?.to_owned()),
    };
    let search = match fields.get("search") {
        None => None,
        Some(value) => Some(parse_search(value)?),
    };
    // A voice ID goes into a request's address, so anything else refuses the whole document.
    let speech_voice = match fields.get("speechVoice") {
        None => None,
        Some(value) => Some(
            value
                .as_str()
                .filter(|voice| voice.len() <= 64 && voice.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')))?
                .to_owned(),
        ),
    };
    Some(Saved { providers, models, reasoning, search, speech_voice })
}

impl DeviceModels for DeviceModelStore {
    /// The device's model for a role. Vision work uses the agent model.
    fn model_id(&self, role: DeviceRole) -> Option<String> {
        let saved = self.saved();
        let saved = saved.as_ref()?;
        let find = |name: &str| saved.models.iter().find(|(role, model)| role == name && !model.is_empty()).map(|(_, model)| model.clone());
        find(role_name(role)).or_else(|| if role == DeviceRole::Fast { find("agent") } else { None })
    }

    fn speech_voice(&self) -> Option<String> {
        self.saved().as_ref().and_then(|saved| saved.speech_voice.clone())
    }

    /// The route a model runs on with this device's key for its provider.
    fn route(&self, model_id: &str) -> Result<ModelRoute, ModelError> {
        let (provider, _) = parse_model_id(model_id)?;
        let saved = self.saved();
        let found = saved.as_ref().and_then(|saved| saved.providers.iter().find(|saved| saved.id == provider));
        let Some(found) = found else {
            return Err(ModelError::Setup { code: "model_key_needed", detail: "Add a model key in Settings → Models.".to_owned() });
        };
        Ok(ModelRoute {
            reasoning: Some(saved.as_ref().and_then(|saved| saved.reasoning.clone()).unwrap_or_else(|| "low".to_owned())),
            credential: Credential { provider, api_key: found.api_key.clone().unwrap_or_default(), base_url: found.base_url.clone() },
        })
    }
}

impl DeviceModelStore {
    fn saved(&self) -> MutexGuard<'_, Option<Saved>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Replaces the device's models; an empty body clears them. False when the body isn't one.
    pub fn set(&self, value: &Value) -> bool {
        if value.is_null() || value.as_object().is_some_and(serde_json::Map::is_empty) {
            *self.saved() = None;
            return true;
        }
        let Some(parsed) = parse_saved(value) else {
            return false;
        };
        *self.saved() = Some(parsed);
        true
    }

    pub(crate) fn reasoning(&self) -> String {
        self.saved().as_ref().and_then(|saved| saved.reasoning.clone()).unwrap_or_else(|| "low".to_owned())
    }

    /// The device's web search provider and key; without one, web.search isn't offered.
    pub(crate) fn search(&self) -> Option<DeviceSearch> {
        self.saved().as_ref().and_then(|saved| saved.search.clone())
    }

    /// Every key the device gave, so a failure never repeats one.
    pub(crate) fn secrets(&self) -> Vec<String> {
        let saved = self.saved();
        let Some(saved) = saved.as_ref() else {
            return Vec::new();
        };
        let keys = saved.providers.iter().filter_map(|provider| provider.api_key.clone()).filter(|key| !key.is_empty());
        keys.chain(saved.search.as_ref().map(|search| search.api_key.clone())).collect()
    }

    /// `scrubCredential` for text: removes every key this device gave. Short values could match
    /// ordinary words, so they stay.
    pub(crate) fn scrubbed(&self, text: &str) -> String {
        let mut out = text.to_owned();
        for secret in self.secrets() {
            let secret = secret.trim();
            if secret.len() >= 8 {
                out = out.replace(secret, "[redacted]");
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn models() -> Value {
        json!({
            "version": 1,
            "providers": { "openrouter": { "apiKey": "sk-or-device-key" }, "ollama": { "baseURL": "http://127.0.0.1:11434/v1" } },
            "models": { "agent": "openrouter/anthropic/claude-sonnet-5.5", "embedding": "ollama/nomic-embed-text" },
            "reasoning": "medium",
        })
    }

    #[test]
    fn keeps_the_devices_choices_and_keys_in_memory() {
        let device = DeviceModelStore::default();
        assert!(device.set(&models()));
        assert_eq!(device.model_id(DeviceRole::Agent).as_deref(), Some("openrouter/anthropic/claude-sonnet-5.5"));
        assert_eq!(device.model_id(DeviceRole::Fast).as_deref(), Some("openrouter/anthropic/claude-sonnet-5.5"));
        assert_eq!(device.secrets(), ["sk-or-device-key"]);
        let route = device.route("openrouter/anthropic/claude-sonnet-5.5").unwrap();
        assert_eq!(route.reasoning.as_deref(), Some("medium"));
        assert_eq!(route.credential.provider, ProviderId::Openrouter);
        assert_eq!(route.credential.api_key, "sk-or-device-key");
    }

    #[test]
    fn refuses_a_body_that_isnt_the_apps_models() {
        let device = DeviceModelStore::default();
        assert!(!device.set(&json!({ "version": 2, "providers": {}, "models": {} })));
        assert!(!device.set(&json!({ "version": 1, "providers": { "unknown": { "apiKey": "x" } }, "models": {} })));
        assert!(!device.set(&json!({ "version": 1, "providers": {}, "models": { "wizard": "abc" } })));
        assert!(!device.set(&json!({ "version": 1, "providers": {}, "models": { "agent": "ab" } })));
    }

    #[test]
    fn asks_for_a_key_when_the_device_has_none_for_the_models_provider() {
        let device = DeviceModelStore::default();
        device.set(&models());
        let error = device.route("anthropic/claude-sonnet-5-5").err().unwrap();
        assert!(error.to_string().contains("model_key_needed"));
    }

    #[test]
    fn lets_a_device_route_reach_a_model_server_on_the_persons_own_computer() {
        let device = DeviceModelStore::default();
        device.set(&models());
        let route = device.route("ollama/nomic-embed-text").unwrap();
        assert_eq!(route.credential.base_url.as_deref(), Some("http://127.0.0.1:11434/v1"));
    }

    #[test]
    fn clears_with_an_empty_body() {
        let device = DeviceModelStore::default();
        device.set(&models());
        assert!(device.set(&json!({})));
        assert_eq!(device.model_id(DeviceRole::Agent), None);
    }

    #[test]
    fn scrubbing_removes_each_key() {
        let device = DeviceModelStore::default();
        device.set(&models());
        assert_eq!(device.scrubbed("bad sk-or-device-key!"), "bad [redacted]!");
    }

    #[test]
    fn a_voice_id_is_kept_and_anything_that_could_change_an_address_is_refused() {
        let store = DeviceModelStore::default();
        let document = |voice: &str| json!({ "version": 1, "providers": {}, "models": {}, "speechVoice": voice });
        assert!(store.set(&document("AbC-12_x")));
        assert_eq!(store.speech_voice().as_deref(), Some("AbC-12_x"));
        for hostile in ["../../v1/user", "a/b", "a?b=c", "a b", &"x".repeat(65)] {
            assert!(!store.set(&document(hostile)), "{hostile}");
        }
        assert_eq!(store.speech_voice().as_deref(), Some("AbC-12_x"), "a refused document changes nothing");
        assert!(store.set(&json!({ "version": 1, "providers": {}, "models": {} })));
        assert_eq!(store.speech_voice(), None);
    }
}
