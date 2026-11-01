//! Sign in with ChatGPT, so agents run on the person's ChatGPT plan. The tokens live in the
//! credential store and are refreshed here; the agent runtime on this computer only ever gets
//! the short-lived access token, in the device's model document. Language models only.
pub mod flow;
pub mod renewal;
#[cfg(test)]
mod tests;

use std::{
    sync::Mutex as SyncMutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tokio::sync::Mutex;

use flow::{Attempt, Endpoints, Stored};
use renewal::Renewal;

use super::oauth;

const SERVICE: &str = "com.misty.models.chatgpt";
const SESSION: &str = "session";
const HOST: &str = "host";

/// One refresh at a time: the refresh token rotates, so two would race.
static RENEWING: Mutex<()> = Mutex::const_new(());
static RENEWAL_TIMER: SyncMutex<Option<tauri::async_runtime::JoinHandle<()>>> =
    SyncMutex::new(None);

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

fn load() -> Option<Stored> {
    let raw = crate::infra::credential_store::load(SERVICE, SESSION)
        .ok()
        .flatten()?;
    serde_json::from_str(&raw).ok()
}

fn save(stored: &Stored) -> Result<(), String> {
    let raw = serde_json::to_string(stored).map_err(|e| e.to_string())?;
    crate::infra::credential_store::store(SERVICE, SESSION, &raw)
        .map_err(|_| "ChatGPT's sign-in couldn't be saved to the keychain.".to_string())
}

/// This computer's opaque host ID, made once before the first sign-in and kept for good.
fn host_id() -> Result<String, String> {
    if let Some(id) = crate::infra::credential_store::load(SERVICE, HOST)
        .ok()
        .flatten()
    {
        return Ok(id);
    }
    let id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
    crate::infra::credential_store::store(SERVICE, HOST, &id)
        .map_err(|_| "Misty couldn't save this computer's ChatGPT ID.".to_string())?;
    Ok(id)
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| "The keychain couldn't be reached.".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    signed_in: bool,
    email: String,
    /// Signed in but the plan grant wasn't given: requests can't use the plan.
    plan_usage: bool,
    /// After signing out: whether ChatGPT confirmed the session was revoked.
    #[serde(skip_serializing_if = "Option::is_none")]
    revoked: Option<bool>,
}

fn status(stored: Option<&Stored>) -> Status {
    Status {
        signed_in: stored.is_some_and(|stored| stored.tokens.is_some()),
        email: stored
            .map(|stored| stored.email.clone())
            .unwrap_or_default(),
        plan_usage: stored.is_some_and(Stored::plan_usage),
        revoked: None,
    }
}

/// A usable access token and when it expires, renewing it first when little is left. None when
/// signed out, when the plan grant is missing, or when the token has run out and can't be renewed.
pub async fn access_token() -> Option<(String, u64)> {
    let _turn = RENEWING.lock().await;
    let stored = blocking(load).await.ok()??;
    if !stored.plan_usage() {
        return None;
    }
    let renewed = match renewal::renew(&oauth::client(), &Endpoints::openai(), &stored, now()).await
    {
        Renewal::Fresh(next) => {
            if next != stored {
                let copy = next.clone();
                blocking(move || save(&copy)).await.ok()?.ok()?;
            }
            next
        }
        Renewal::SignedOut(next) => {
            let _ = blocking(move || save(&next)).await;
            return None;
        }
        Renewal::Unchanged => stored,
    };
    let tokens = renewed.tokens?;
    (tokens.expires_at > now()).then_some((tokens.access_token, tokens.expires_at))
}

/// Gives the runtime a new token shortly before the one it holds expires.
pub fn renew_before(expires_at: u64) {
    let wait = expires_at
        .saturating_sub(now() + flow::REFRESH_MARGIN_SECS)
        .max(30);
    let timer = tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(wait)).await;
        super::invalidate();
    });
    if let Ok(mut slot) = RENEWAL_TIMER.lock() {
        if let Some(previous) = slot.replace(timer) {
            previous.abort();
        }
    }
}

#[tauri::command]
pub async fn model_keys_chatgpt_status() -> Result<Status, String> {
    let stored = blocking(load).await?;
    Ok(status(stored.as_ref()))
}

/// Opens the browser at ChatGPT's sign-in and waits for it to come back to this computer.
#[tauri::command]
pub async fn model_keys_chatgpt_sign_in() -> Result<Status, String> {
    let endpoints = Endpoints::openai();
    let previous = blocking(load).await?;
    let host = blocking(host_id).await??;
    let loopback = oauth::Loopback::bind(false).await?;
    let redirect_uri = format!("http://127.0.0.1:{}{}", loopback.port, flow::CALLBACK_PATH);
    let (state, nonce, verifier) = (
        oauth::random_token(),
        oauth::random_token(),
        oauth::random_token(),
    );
    let client_id = previous
        .as_ref()
        .map(|p| p.client_id.clone())
        .filter(|id| !id.is_empty());
    let id_token = previous
        .as_ref()
        .map(|p| p.id_token.clone())
        .filter(|t| !t.is_empty());
    let email = previous
        .as_ref()
        .map(|p| p.email.clone())
        .filter(|e| !e.is_empty());
    let url = flow::authorize_url(
        &endpoints,
        &Attempt {
            client_id: client_id.as_deref(),
            host_id: &host,
            redirect_uri: &redirect_uri,
            state: &state,
            nonce: &nonce,
            challenge: &oauth::challenge(&verifier),
            id_token_hint: id_token.as_deref(),
            login_hint: email.as_deref(),
        },
    );
    oauth::open_browser(&url)?;
    let query = loopback
        .wait(flow::CALLBACK_PATH, oauth::SIGN_IN_WINDOW)
        .await?;
    let (code, client) = flow::callback(&query, &state, client_id.as_deref())?;
    let http = oauth::client();
    let response =
        flow::exchange(&http, &endpoints, &client, &code, &verifier, &redirect_uri).await?;
    let stored = flow::accept(
        response,
        &endpoints,
        &client,
        &nonce,
        now(),
        previous.as_ref(),
    )?;
    let copy = stored.clone();
    blocking(move || save(&copy)).await??;
    super::invalidate();
    Ok(status(Some(&stored)))
}

/// Revokes the session and forgets its tokens; the registration stays for signing in again.
#[tauri::command]
pub async fn model_keys_chatgpt_sign_out() -> Result<Status, String> {
    let Some(stored) = blocking(load).await? else {
        return Ok(status(None));
    };
    let revoked = renewal::revoke(&oauth::client(), &Endpoints::openai(), &stored).await;
    let cleared = renewal::signed_out(&stored);
    blocking(move || save(&cleared)).await??;
    super::invalidate();
    Ok(Status {
        revoked: Some(revoked),
        ..status(None)
    })
}
