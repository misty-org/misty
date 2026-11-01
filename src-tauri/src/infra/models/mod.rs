//! Bring-your-own-key models. Provider keys live in Misty's credential store (sealed rows
//! whose master key is in the OS keychain), one entry per provider under
//! `com.misty.models`, and so do the web search keys (Decodo, Serper); the model choices are device settings (section `models` of
//! `misty.db`). The renderer can save, replace or remove a key and learn which providers
//! have one; it can never read a key back. Only the agent runtime on this computer gets
//! them (`agent_runtime`), as a model document with a fresh ChatGPT access token when the
//! person signed in with ChatGPT (`chatgpt`); no server ever does.
pub mod catalog;
pub mod chatgpt;
pub mod header;
pub mod keys;
pub mod oauth;

use serde_json::Value;
use tauri::Manager;

use crate::app::runtime::MistyRuntime;

/// The credential-store service that holds one key per provider ID.
pub const KEY_SERVICE: &str = "com.misty.models";
const MAX_KEY_BYTES: usize = 4096;

/// Gives the agent runtime on this computer the new choices and keys.
pub fn invalidate() {
    crate::infra::agent_runtime::models_changed();
}

fn load_key(provider: &str) -> Option<String> {
    crate::infra::credential_store::load(KEY_SERVICE, provider)
        .ok()
        .flatten()
}

fn saved_providers() -> Vec<String> {
    header::PROVIDERS
        .iter()
        .chain(header::SEARCH_PROVIDERS.iter())
        .filter(|provider| load_key(provider).is_some_and(|key| !key.is_empty()))
        .map(|provider| (*provider).to_owned())
        .collect()
}

/// This device's model choices and keys, for the agent runtime on this computer. None when
/// no agent model has a usable provider.
pub async fn current_document(app: &tauri::AppHandle) -> Option<Value> {
    let runtime = app.try_state::<MistyRuntime>()?;
    let document = runtime.settings.document().await.ok()?;
    let section = document.get("models").cloned().unwrap_or(Value::Null);
    let uses_chatgpt = header::ROLES.iter().any(|(_, setting)| {
        section
            .get(*setting)
            .and_then(Value::as_str)
            .is_some_and(|model| model.trim().starts_with("chatgpt/"))
    });
    let chatgpt = if uses_chatgpt {
        chatgpt::access_token().await
    } else {
        None
    };
    if let Some((_, expires_at)) = &chatgpt {
        // The runtime holds this token; it gets the next one before this one runs out.
        chatgpt::renew_before(*expires_at);
    }
    let token = chatgpt.map(|(token, _)| token);
    tokio::task::spawn_blocking(move || {
        header::document(&section, &|provider| match provider {
            "chatgpt" => token.clone(),
            _ => load_key(provider),
        })
    })
    .await
    .ok()?
}

fn provider(id: &str) -> Result<&str, String> {
    if header::is_provider(id) || header::SEARCH_PROVIDERS.contains(&id) {
        Ok(id)
    } else {
        Err("That model provider isn't supported.".into())
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| "The keychain couldn't be reached.".to_string())?
}

/// The providers that have a saved key. Never the keys themselves.
#[tauri::command]
pub async fn model_keys_saved() -> Result<Vec<String>, String> {
    blocking(|| Ok(saved_providers())).await
}

/// Saves or replaces one provider's key, then returns the providers that have one.
#[tauri::command]
pub async fn model_keys_save(provider_id: String, key: String) -> Result<Vec<String>, String> {
    let provider_id = provider(&provider_id)?.to_owned();
    if provider_id == "chatgpt" {
        return Err("ChatGPT takes a sign-in, not a key.".into());
    }
    let key = key.trim().to_owned();
    if key.is_empty() || key.len() > MAX_KEY_BYTES || key.chars().any(char::is_control) {
        return Err("That key doesn't look right. Paste it again.".into());
    }
    blocking(move || {
        crate::infra::credential_store::store(KEY_SERVICE, &provider_id, &key)
            .map_err(|_| "The key couldn't be saved to the keychain.".to_string())?;
        invalidate();
        Ok(saved_providers())
    })
    .await
}

/// Removes one provider's key, then returns the providers that still have one.
#[tauri::command]
pub async fn model_keys_remove(provider_id: String) -> Result<Vec<String>, String> {
    let provider_id = provider(&provider_id)?.to_owned();
    blocking(move || {
        crate::infra::credential_store::delete(KEY_SERVICE, &provider_id)
            .map_err(|_| "The key couldn't be removed from the keychain.".to_string())?;
        invalidate();
        Ok(saved_providers())
    })
    .await
}

#[cfg(test)]
mod tests;
