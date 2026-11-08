//! Native account sessions. Misty's JWTs live here and in OS-protected storage, and never enter
//! the renderer or WebKit. Requests carry the access token as `Authorization: Bearer`.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use zeroize::{Zeroize, Zeroizing};

mod commands;
mod refresh;
pub use commands::*;
pub(crate) use refresh::RefreshAnswer;

/// Asks the server to answer with tokens in headers instead of cookies. It agrees only for a
/// request with no `Origin`, which a page can never send.
pub(crate) const TOKEN_TRANSPORT: (&str, &str) = ("x-misty-token-transport", "bearer");
const ACCESS_TOKEN_HEADER: HeaderName = HeaderName::from_static("x-misty-access-token");
const REFRESH_TOKEN_HEADER: HeaderName = HeaderName::from_static("x-misty-refresh-token");
const SESSION_ENDED_HEADER: HeaderName = HeaderName::from_static("x-misty-session-ended");

static CLIENTS: OnceLock<Mutex<HashMap<String, Arc<AccountClient>>>> = OnceLock::new();

/// What a server's response did to the session.
pub(crate) enum Captured {
    Nothing,
    Signed,
    Ended,
}

struct Tokens {
    account_id: String,
    origin: String,
    access: Option<Zeroizing<String>>,
    refresh: Zeroizing<String>,
}

pub(crate) struct AccountClient {
    pub http: reqwest::Client,
    /// Held for every /auth/refresh of this client, from the renderer or from native work, so
    /// no two requests ever present the same refresh token.
    refresh_lock: tokio::sync::Mutex<()>,
    tokens: Mutex<Option<Tokens>>,
    /// The account whose saved row this client wrote.
    account_id: Mutex<Option<String>>,
}

/// The saved form. Rows from when these were cookies have the same fields, so those sign-ins go on.
#[derive(Serialize, Deserialize)]
struct SavedSession {
    account_id: String,
    origin: String,
    access: Option<String>,
    refresh: String,
}

impl Drop for SavedSession {
    fn drop(&mut self) {
        self.refresh.zeroize();
        self.access.zeroize();
    }
}

pub(crate) fn server(raw: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(raw).map_err(|_| "Invalid API URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Invalid API URL".into());
    }
    Ok(url)
}
fn key(url: &url::Url, account_id: &str) -> String {
    format!("{}\n{}", url.origin().ascii_serialization(), account_id)
}
fn clients() -> &'static Mutex<HashMap<String, Arc<AccountClient>>> {
    CLIENTS.get_or_init(Default::default)
}

fn credential_io<T>(operation: impl FnOnce() -> std::io::Result<T>) -> Result<T, String> {
    let run = || operation().map_err(|error| error.to_string());
    // Keep the account lifecycle barrier, but let Tokio service other work while
    // this worker blocks (including on another credential operation's mutex).
    if tokio::runtime::Handle::try_current()
        .is_ok_and(|handle| handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread)
    {
        tokio::task::block_in_place(run)
    } else {
        run()
    }
}

/// An `Authorization` value, kept out of anything that prints headers.
pub(crate) fn authorization(bearer: &str) -> Result<HeaderValue, String> {
    let mut value = HeaderValue::from_str(bearer).map_err(|_| "Invalid session token")?;
    value.set_sensitive(true);
    Ok(value)
}

/// A response's headers without the session: the renderer never sees a token.
pub(super) fn renderer_headers(headers: &HeaderMap) -> Vec<(String, String)> {
    headers
        .iter()
        .filter(|(name, _)| {
            *name != reqwest::header::SET_COOKIE
                && *name != ACCESS_TOKEN_HEADER
                && *name != REFRESH_TOKEN_HEADER
                && *name != SESSION_ENDED_HEADER
        })
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect()
}

impl AccountClient {
    pub(super) fn new() -> Result<Arc<Self>, String> {
        let http = reqwest::Client::builder()
            .user_agent(format!(
                "MistyDesktop/{} ({})",
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS
            ))
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(90))
            .build()
            .map_err(|_| "Could not initialize account HTTP client")?;
        Ok(Arc::new(Self {
            http,
            refresh_lock: Default::default(),
            tokens: Mutex::new(None),
            account_id: Mutex::new(None),
        }))
    }
    pub(crate) fn require_account(&self, url: &url::Url, expected: &str) -> Result<(), String> {
        let saved = self
            .snapshot(url)?
            .ok_or("Sign in before connecting browser sync")?;
        if saved.account_id != expected {
            return Err("The native account does not match this workspace".into());
        }
        Ok(())
    }
    /// `Bearer <access>`, when this client holds an access token. Its expiry is the server's call:
    /// a computer whose clock runs fast must still be able to use the token it was just given.
    pub(crate) fn access_header(&self) -> Option<String> {
        let tokens = self.tokens.lock().ok()?;
        let access = tokens.as_ref()?.access.as_ref()?;
        Some(format!("Bearer {}", access.as_str()))
    }
    /// `Bearer <refresh>`, only for the server these tokens came from.
    pub(super) fn refresh_header(&self, url: &url::Url) -> Option<String> {
        let tokens = self.tokens.lock().ok()?;
        let tokens = tokens
            .as_ref()
            .filter(|tokens| tokens.origin == url.origin().ascii_serialization())?;
        Some(format!("Bearer {}", tokens.refresh.as_str()))
    }
    fn snapshot(&self, url: &url::Url) -> Result<Option<SavedSession>, String> {
        let tokens = self
            .tokens
            .lock()
            .map_err(|_| "Account session unavailable")?;
        Ok(tokens
            .as_ref()
            .filter(|tokens| tokens.origin == url.origin().ascii_serialization())
            .map(|tokens| SavedSession {
                account_id: tokens.account_id.clone(),
                origin: tokens.origin.clone(),
                access: tokens.access.as_ref().map(|access| access.to_string()),
                refresh: tokens.refresh.to_string(),
            }))
    }
    /// Takes tokens the server issued, after checking they are one account's and each what it
    /// claims to be. Returns the account.
    fn set_tokens(&self, url: &url::Url, access: &str, refresh: &str) -> Result<String, String> {
        let (subject, _) = identity(refresh, "refresh")?;
        if identity(access, "access")?.0 != subject {
            return Err("Account session mismatch".into());
        }
        *self
            .tokens
            .lock()
            .map_err(|_| "Account session unavailable")? = Some(Tokens {
            account_id: subject.clone(),
            origin: url.origin().ascii_serialization(),
            access: Some(Zeroizing::new(access.to_owned())),
            refresh: Zeroizing::new(refresh.to_owned()),
        });
        Ok(subject)
    }
    pub(super) fn clear(&self) -> Result<(), String> {
        *self
            .tokens
            .lock()
            .map_err(|_| "Account session unavailable")? = None;
        Ok(())
    }
    /// Whatever a response says about the session, taken and saved.
    pub(crate) fn capture(&self, url: &url::Url, headers: &HeaderMap) -> Result<Captured, String> {
        if headers.contains_key(SESSION_ENDED_HEADER) {
            self.clear()?;
            self.persist(url)?;
            return Ok(Captured::Ended);
        }
        let token = |name| {
            headers
                .get(name)
                .and_then(|value: &HeaderValue| value.to_str().ok())
        };
        let (Some(access), Some(refresh)) =
            (token(&ACCESS_TOKEN_HEADER), token(&REFRESH_TOKEN_HEADER))
        else {
            return Ok(Captured::Nothing);
        };
        self.set_tokens(url, access, refresh)?;
        self.persist(url)?;
        Ok(Captured::Signed)
    }
    pub(crate) fn persist(&self, url: &url::Url) -> Result<Option<String>, String> {
        if let Some(saved) = self.snapshot(url)? {
            let encoded = Zeroizing::new(
                serde_json::to_string(&saved).map_err(|_| "Could not encode account session")?,
            );
            credential_io(|| {
                misty_credential_store::account::store(&key(url, &saved.account_id), &encoded)
            })?;
            *self
                .account_id
                .lock()
                .map_err(|_| "Account session unavailable")? = Some(saved.account_id.clone());
            return Ok(Some(saved.account_id.clone()));
        }
        let mut account_id = self
            .account_id
            .lock()
            .map_err(|_| "Account session unavailable")?;
        if let Some(saved_account) = account_id.as_deref() {
            credential_io(|| misty_credential_store::account::delete(&key(url, saved_account)))?;
            *account_id = None;
        }
        Ok(None)
    }
    fn restore(url: &url::Url, account_id: &str, value: &str) -> Result<Option<Arc<Self>>, String> {
        let saved: SavedSession =
            serde_json::from_str(value).map_err(|_| "Invalid saved session")?;
        if saved.account_id != account_id || saved.origin != url.origin().ascii_serialization() {
            return Err("Saved session does not match this server and account".into());
        }
        let (subject, expiry) = identity(&saved.refresh, "refresh")?;
        if subject != account_id {
            return Err("Saved session account mismatch".into());
        }
        if expiry <= now() {
            return Ok(None);
        }
        let mut access = None;
        if let Some(saved_access) = &saved.access {
            let (subject, expiry) = identity(saved_access, "access")?;
            if subject != account_id {
                return Err("Saved access token account mismatch".into());
            }
            if expiry > now() {
                access = Some(Zeroizing::new(saved_access.clone()));
            }
        }
        let client = Self::new()?;
        *client
            .tokens
            .lock()
            .map_err(|_| "Account session unavailable")? = Some(Tokens {
            account_id: account_id.to_owned(),
            origin: saved.origin.clone(),
            access,
            refresh: Zeroizing::new(saved.refresh.clone()),
        });
        *client
            .account_id
            .lock()
            .map_err(|_| "Account session unavailable")? = Some(account_id.to_owned());
        Ok(Some(client))
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
// The native client decodes only to select a saved account and preserve expiry. Every
// authenticated request is verified cryptographically by the server.
fn identity(token: &str, kind: &str) -> Result<(String, u64), String> {
    if token.len() > 4096 || token.split('.').count() != 3 {
        return Err("Invalid session token".into());
    }
    let payload = URL_SAFE_NO_PAD
        .decode(token.split('.').nth(1).unwrap_or_default())
        .map_err(|_| "Invalid session token")?;
    let claims: serde_json::Value =
        serde_json::from_slice(&payload).map_err(|_| "Invalid session token")?;
    if claims["token_use"].as_str() != Some(kind) {
        return Err("Invalid session token purpose".into());
    }
    let subject = claims["sub"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or("Missing session account")?;
    let expiry = claims["exp"].as_u64().ok_or("Missing session expiry")?;
    Ok((subject.to_owned(), expiry))
}

pub(crate) fn current(url: &url::Url) -> Result<Arc<AccountClient>, String> {
    let mut map = clients()
        .lock()
        .map_err(|_| "Account session unavailable")?;
    let origin = url.origin().ascii_serialization();
    if let Some(client) = map.get(&origin) {
        return Ok(client.clone());
    }
    let client = AccountClient::new()?;
    map.insert(origin, client.clone());
    Ok(client)
}
/// Replaces a server's client, leaving the windows with the account they have.
fn install(url: &url::Url, client: Arc<AccountClient>) -> Result<(), String> {
    clients()
        .lock()
        .map_err(|_| "Account session unavailable")?
        .insert(url.origin().ascii_serialization(), client);
    Ok(())
}
/// The client's account becomes this computer's: every window now belongs to it.
pub(super) fn activate(url: &url::Url, client: Arc<AccountClient>) -> Result<(), String> {
    let account = client.snapshot(url)?.map(|saved| saved.account_id.clone());
    install(url, client)?;
    set_account(url, account.as_deref());
    Ok(())
}
/// The windows belong to `account` on this server, or to nobody.
pub(super) fn set_account(url: &url::Url, account: Option<&str>) {
    crate::browser::app_windows::set_scope(&crate::browser::profiles::account_scope(url, account));
}
fn has_active_account(url: &url::Url, account: Option<&str>) -> bool {
    account.filter(|id| !id.is_empty()).is_some_and(|account| {
        current(url).is_ok_and(|client| {
            client.snapshot(url).is_ok_and(|saved| {
                saved.is_some_and(|saved| {
                    saved.account_id == account
                        && identity(&saved.refresh, "refresh")
                            .is_ok_and(|(_, expiry)| expiry > now())
                })
            })
        })
    })
}

/// `scope` is the account the windows belong to now.
fn restore_preserves_scope(url: &url::Url, account: Option<&str>, scope: &str) -> bool {
    has_active_account(url, account)
        && scope == crate::browser::profiles::account_scope(url, account)
}

#[cfg(test)]
mod tests;
