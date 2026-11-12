//! Adding a key by pasting it and listing a provider's models. Keys go straight to the
//! credential store; the renderer learns only the provider and its models.
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

use super::{
    catalog::{self, ListError, ModelInfo},
    header,
};
use crate::app::runtime::MistyRuntime;

fn http() -> reqwest::Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Added {
    provider: String,
    models: Vec<ModelInfo>,
    saved: Vec<String>,
}

fn store_key(provider: String, key: String) -> Result<Vec<String>, String> {
    crate::account::credential_store::store(super::KEY_SERVICE, &provider, &key)
        .map_err(|_| "The key couldn't be saved to the keychain.".to_string())?;
    super::invalidate();
    Ok(super::saved_providers())
}

/// Finds which provider a pasted key is for (or checks it against the one named), confirms it by
/// listing that provider's models with it, then saves it.
#[tauri::command]
pub async fn model_keys_add(key: String, provider: Option<String>) -> Result<Added, String> {
    let key = key.trim().to_owned();
    if key.is_empty() || key.len() > 4096 || key.chars().any(char::is_control) {
        return Err("That key doesn't look right. Paste it again.".into());
    }
    let candidates: Vec<String> = match provider {
        Some(provider) if header::is_provider(&provider) => vec![provider],
        Some(_) => return Err("That model provider isn't supported.".into()),
        None => catalog::candidates(&key)
            .into_iter()
            .map(str::to_owned)
            .collect(),
    };
    if candidates.is_empty() {
        return Err("That looks like a voice key. Add it under Voice.".into());
    }
    let http = http();
    let mut last = String::new();
    for candidate in candidates {
        // A server on this device's network, or a voice key: nothing to list it against.
        let listed = match catalog::listing(&candidate, None) {
            Some(listing) => catalog::list(&http, &candidate, &listing, &key).await,
            None => Ok(Vec::new()),
        };
        match listed {
            Ok(models) => {
                let provider = candidate.clone();
                let saved = tokio::task::spawn_blocking(move || store_key(candidate, key))
                    .await
                    .map_err(|_| "The keychain couldn't be reached.".to_string())??;
                return Ok(Added {
                    provider,
                    models,
                    saved,
                });
            }
            Err(ListError::Rejected) => {
                last = format!("{} didn't accept that key.", catalog::label(&candidate));
            }
            Err(ListError::Unreachable) => {
                last = format!(
                    "{} couldn't be reached. Check your connection.",
                    catalog::label(&candidate)
                );
            }
        }
    }
    Err(if last.is_empty() {
        "Misty couldn't tell which provider that key is for.".into()
    } else {
        last
    })
}

async fn models_setting(app: &tauri::AppHandle, key: &str) -> Option<String> {
    let runtime = app.try_state::<MistyRuntime>()?;
    let document = runtime.settings.document().await.ok()?;
    document
        .get("models")?
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
}

/// The models a provider offers this device, with its saved key.
#[tauri::command]
pub async fn model_keys_models(
    app: tauri::AppHandle,
    provider: String,
) -> Result<Vec<ModelInfo>, String> {
    if !header::is_provider(&provider) {
        return Err("That model provider isn't supported.".into());
    }
    let id = provider.clone();
    let key = tokio::task::spawn_blocking(move || super::load_key(&id))
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let base = match header::base_url_setting(&provider) {
        Some(setting) => models_setting(&app, setting).await,
        None => None,
    };
    let listing =
        catalog::listing(&provider, base.as_deref()).ok_or("This provider has no model list.")?;
    catalog::list(&http(), &provider, &listing, &key)
        .await
        .map_err(|error| match error {
            ListError::Rejected => {
                format!("{} didn't accept the saved key.", catalog::label(&provider))
            }
            ListError::Unreachable => format!("{} couldn't be reached.", catalog::label(&provider)),
        })
}
