//! Misty holds no keys and has no model of its own (AGENTS.md): its own work runs on the default
//! engine the person picks. What's left here gives the agent runtime, which stays in the code but
//! is never started for a run, an empty model document, and once, on the first start after keys
//! went away, removes the keys an older Misty kept (model, voice and search keys, the Composio
//! key and this computer's Composio user). It never reads or logs one.
use serde_json::Value;

/// Where older versions kept each model, voice and search key, one row per provider.
const OLD_KEY_SERVICE: &str = "com.misty.models";
const OLD_KEYS: [&str; 14] = [
    "openai",
    "anthropic",
    "google",
    "openrouter",
    "gateway",
    "nvidia",
    "ollama",
    "ollama-cloud",
    "openai-compatible",
    "elevenlabs",
    "soniox",
    "decodo",
    "serper",
    "composio",
];
/// Where older versions kept this computer's Composio user.
const OLD_COMPOSIO_SERVICE: &str = "com.misty.composio";
const OLD_COMPOSIO_USER: &str = "computer_user";
/// Written once the old keys are gone, so they're removed only once.
const FORGOTTEN_MARK: &str = "keys-removed-v1";

/// Tells the agent runtime, if it's running, that settings changed.
pub fn invalidate() {
    crate::agents::run_control::models_changed();
}

/// The model document the agent runtime gets: none, since Misty holds no keys.
pub async fn device_document(_app: &tauri::AppHandle) -> Result<Option<Value>, String> {
    Ok(None)
}

/// Removes the keys an older Misty kept, once. A key that couldn't be removed is tried again on
/// the next start.
pub fn forget_old_keys() {
    let Some(home) = file_access::paths::misty_home_dir() else {
        return;
    };
    let mark = home.join(FORGOTTEN_MARK);
    if mark.exists() {
        return;
    }
    let mut all_gone = true;
    for name in OLD_KEYS {
        all_gone &= crate::account::credential_store::delete(OLD_KEY_SERVICE, name).is_ok();
    }
    all_gone &=
        crate::account::credential_store::delete(OLD_COMPOSIO_SERVICE, OLD_COMPOSIO_USER).is_ok();
    if all_gone {
        let _ = std::fs::write(mark, b"");
    }
}
