//! Bring-your-own-key models. Provider keys live in Misty's credential store (sealed rows
//! whose master key is in the OS keychain), one entry per provider under
//! `com.misty.models`; the model choices are device settings (section `models` of
//! `misty.db`). The renderer can save, replace or remove a key and learn which providers
//! have one; it can never read a key back. Requests to the account server carry both as
//! the `X-Misty-Models` header, added natively (see `account::http`).
pub mod header;

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use serde_json::Value;
use tauri::Manager;

use crate::app::runtime::MistyRuntime;

/// The credential-store service that holds one key per provider ID.
pub const KEY_SERVICE: &str = "com.misty.models";
const MAX_KEY_BYTES: usize = 4096;
/// A built header is reused this long; saving a key or a setting clears it at once.
const CACHE_TTL: Duration = Duration::from_secs(60);

static CACHE: Mutex<Option<(Instant, Option<String>)>> = Mutex::new(None);

/// Forgets the built header so the next request reads keys and settings again.
pub fn invalidate() {
    if let Ok(mut cache) = CACHE.lock() {
        *cache = None;
    }
}

fn load_key(provider: &str) -> Option<String> {
    crate::infra::credential_store::load(KEY_SERVICE, provider)
        .ok()
        .flatten()
}

fn saved_providers() -> Vec<String> {
    header::PROVIDERS
        .iter()
        .filter(|provider| load_key(provider).is_some_and(|key| !key.is_empty()))
        .map(|provider| (*provider).to_owned())
        .collect()
}

/// The header for the next account request, or None when this device has no usable
/// agent model. Reads the keychain off the async runtime.
pub async fn current_header(app: &tauri::AppHandle) -> Option<String> {
    if let Ok(cache) = CACHE.lock() {
        if let Some((built, value)) = cache.as_ref() {
            if built.elapsed() < CACHE_TTL {
                return value.clone();
            }
        }
    }
    let runtime = app.try_state::<MistyRuntime>()?;
    let document = runtime.settings.document().await.ok()?;
    let section = document.get("models").cloned().unwrap_or(Value::Null);
    let value = tokio::task::spawn_blocking(move || header::encode(&section, &load_key))
        .await
        .ok()?;
    if let Ok(mut cache) = CACHE.lock() {
        *cache = Some((Instant::now(), value.clone()));
    }
    value
}

fn provider(id: &str) -> Result<&str, String> {
    if header::is_provider(id) {
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
