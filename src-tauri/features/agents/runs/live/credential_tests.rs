//! `test/live-relay.test.ts`: which key a live session runs on, and what a session may ask for.
use std::collections::HashMap;

use serde_json::json;

use super::{
    super::device::{DeviceCallFailure, DeviceModels, DeviceRole},
    credential::live_soniox_key,
    open_soniox,
    segment::LiveChannel,
    session::LiveSessionSpec,
    session_tests::spec,
};
use crate::model_calls::{parse_model_id, Credential, ModelError, ModelRoute};

#[derive(Default)]
struct Keys(HashMap<&'static str, &'static str>);

impl DeviceModels for Keys {
    fn model_id(&self, _role: DeviceRole) -> Option<String> {
        None
    }

    fn route(&self, model_id: &str) -> Result<ModelRoute, ModelError> {
        let (provider, _) = parse_model_id(model_id)?;
        let key = self.0.get(provider.as_str()).ok_or_else(|| ModelError::Setup {
            code: "model_key_needed",
            detail: "Add a model key in Settings → Models.".to_owned(),
        })?;
        Ok(ModelRoute { reasoning: None, credential: Credential { provider, api_key: (*key).to_owned(), base_url: None } })
    }
}

fn client() -> reqwest::Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::new()
}

fn setup_code(error: ModelError) -> &'static str {
    match error {
        ModelError::Setup { code, .. } => code,
        other => panic!("{other}"),
    }
}

#[test]
fn runs_on_the_devices_own_soniox_key() {
    let keys = Keys(HashMap::from([("soniox", "soniox-device-key")]));
    assert_eq!(live_soniox_key(&keys, "soniox/stt-rt-v4", &client()).unwrap(), "soniox-device-key");
}

#[test]
fn asks_for_a_key_when_the_device_has_none_and_refuses_other_providers() {
    let keys = Keys(HashMap::from([("openai", "k")]));
    assert_eq!(setup_code(live_soniox_key(&keys, "soniox/stt-rt-v4", &client()).err().unwrap()), "model_key_needed");
    assert_eq!(setup_code(live_soniox_key(&keys, "openai/gpt-realtime", &client()).err().unwrap()), "model_unsupported");
}

#[test]
fn a_refused_session_says_why_and_never_gives_the_key() {
    let refused = open_soniox(&Keys::default(), &spec(1), &client()).err().unwrap();
    assert_eq!(refused, DeviceCallFailure { status: 409, body: json!({ "code": "model_key_needed", "message": "Add a model key in Settings → Models." }) });
}

#[test]
fn a_session_needs_a_channel_it_knows() {
    let spec = LiveSessionSpec::for_device(&["mic".to_owned(), "system".to_owned()], "en").unwrap();
    assert_eq!(spec.channels, [LiveChannel::Mic, LiveChannel::System]);
    assert_eq!(spec.language.as_deref(), Some("en"));
    assert_eq!(spec.model, "soniox/stt-rt-v5");
    assert_eq!(spec.max_ms, 14_400_000);
    assert_eq!(spec.sid.len(), 32);
    assert_eq!(LiveSessionSpec::for_device(&["mic".to_owned()], "auto").unwrap().language, None);
    for bad in [&[][..], &["camera".to_owned()][..]] {
        assert_eq!(LiveSessionSpec::for_device(bad, "").unwrap_err(), "Choose the microphone, this computer's sound, or both.");
    }
}
