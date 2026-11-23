use serde_json::Value;

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
const OLD_COMPOSIO_SERVICE: &str = "com.misty.composio";
const OLD_COMPOSIO_USER: &str = "computer_user";
const FORGOTTEN_MARK: &str = "keys-removed-v1";

pub fn invalidate() {
    crate::agents::run_control::models_changed();
}

pub async fn device_document(_app: &tauri::AppHandle) -> Result<Option<Value>, String> {
    Ok(None)
}

pub fn forget_old_keys() {
    let Some(home) = file_access::paths::misty_home_dir() else {
        return;
    };
    let mark = home.join(FORGOTTEN_MARK);
    if file_access::fs::exists(&mark) {
        return;
    }
    let mut all_gone = true;
    for name in OLD_KEYS {
        all_gone &= crate::account::credential_store::delete(OLD_KEY_SERVICE, name).is_ok();
    }
    all_gone &=
        crate::account::credential_store::delete(OLD_COMPOSIO_SERVICE, OLD_COMPOSIO_USER).is_ok();
    if all_gone {
        let _ = file_access::fs::write(mark, b"");
    }
}
