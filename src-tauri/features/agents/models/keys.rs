//! Adding a key by pasting it, signing in to OpenRouter for one, and listing a provider's
//! models. Keys go straight to the credential store; the renderer learns only the provider and
//! its models.
use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

use super::{
    catalog::{self, ListError, ModelInfo},
    header, oauth,
};
use crate::app::runtime::MistyRuntime;

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
        Some(provider) if header::is_provider(&provider) && provider != "chatgpt" => vec![provider],
        Some(_) => return Err("That model provider isn't supported.".into()),
        None => catalog::candidates(&key)
            .into_iter()
            .map(str::to_owned)
            .collect(),
    };
    if candidates.is_empty() {
        return Err("That looks like a voice key. Add it under Voice.".into());
    }
    let http = oauth::client();
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

/// The models a provider offers this device, with its saved key or sign-in.
#[tauri::command]
pub async fn model_keys_models(
    app: tauri::AppHandle,
    provider: String,
) -> Result<Vec<ModelInfo>, String> {
    if !header::is_provider(&provider) {
        return Err("That model provider isn't supported.".into());
    }
    let key = if provider == "chatgpt" {
        super::chatgpt::access_token()
            .await
            .map(|(token, _)| token)
            .ok_or("Sign in with ChatGPT first.")?
    } else {
        let id = provider.clone();
        tokio::task::spawn_blocking(move || super::load_key(&id))
            .await
            .ok()
            .flatten()
            .unwrap_or_default()
    };
    let base = match header::base_url_setting(&provider) {
        Some(setting) => models_setting(&app, setting).await,
        None => None,
    };
    let listing =
        catalog::listing(&provider, base.as_deref()).ok_or("This provider has no model list.")?;
    catalog::list(&oauth::client(), &provider, &listing, &key)
        .await
        .map_err(|error| match error {
            ListError::Rejected => {
                format!("{} didn't accept the saved key.", catalog::label(&provider))
            }
            ListError::Unreachable => format!("{} couldn't be reached.", catalog::label(&provider)),
        })
}

/// OpenRouter's PKCE key flow (openrouter.ai/docs/use-cases/oauth-pkce): the person approves in
/// the browser, OpenRouter makes a key for Misty, and the key is saved like a pasted one.
#[tauri::command]
pub async fn model_keys_openrouter_sign_in() -> Result<Added, String> {
    let loopback = oauth::Loopback::bind(true).await?;
    let callback = format!("http://localhost:{}/callback", loopback.port);
    let (verifier, state) = (oauth::random_token(), oauth::random_token());
    let mut url = url::Url::parse("https://openrouter.ai/auth").expect("OpenRouter URL");
    url.query_pairs_mut()
        .append_pair("callback_url", &callback)
        .append_pair("code_challenge", &oauth::challenge(&verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("key_label", "Misty");
    oauth::open_browser(url.as_str())?;
    let query = loopback.wait("/callback", oauth::SIGN_IN_WINDOW).await?;
    if query
        .get("state")
        .is_some_and(|returned| returned != &state)
    {
        return Err("The sign-in came back for another attempt. Try again.".into());
    }
    let code = query
        .get("code")
        .filter(|code| !code.is_empty())
        .ok_or("OpenRouter sign-in was cancelled.")?;
    let response = oauth::client()
        .post("https://openrouter.ai/api/v1/auth/keys")
        .json(&serde_json::json!({ "code": code, "code_verifier": verifier, "code_challenge_method": "S256" }))
        .send()
        .await
        .map_err(|_| "OpenRouter couldn't be reached.".to_string())?;
    if !response.status().is_success() {
        return Err("OpenRouter didn't accept the sign-in. Try again.".into());
    }
    let body: Value = response.json().await.unwrap_or(Value::Null);
    let key = body["key"]
        .as_str()
        .filter(|key| !key.is_empty())
        .ok_or("OpenRouter didn't send a key.")?;
    model_keys_add(key.to_owned(), Some("openrouter".into())).await
}
