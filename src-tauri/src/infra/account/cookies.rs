//! Native account cookie jars. Credentials never enter the renderer or WebKit.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::cookie::{CookieStore, Jar};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

mod commands;
pub use commands::*;

static CLIENTS: OnceLock<Mutex<HashMap<String, Arc<AccountClient>>>> = OnceLock::new();

pub(in crate::infra) struct AccountClient {
    pub http: reqwest::Client,
    /// Held for every /auth/refresh sent through this jar, from the renderer or
    /// from browser sync, so no two requests ever present the same refresh cookie.
    pub refresh_lock: Arc<tokio::sync::Mutex<()>>,
    jar: Arc<Jar>,
    account_id: Mutex<Option<String>>,
}
#[derive(Serialize, Deserialize)]
struct SavedCookies {
    account_id: String,
    origin: String,
    access: Option<String>,
    refresh: String,
}

pub(in crate::infra) fn server(raw: &str) -> Result<url::Url, String> {
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

impl AccountClient {
    pub(super) fn new() -> Result<Arc<Self>, String> {
        let jar = Arc::new(Jar::default());
        let http = reqwest::Client::builder()
            .cookie_provider(jar.clone())
            // The server admits coding only from the Misty app, which names
            // itself with this user agent (coding_access.go).
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
            jar,
            account_id: Mutex::new(None),
        }))
    }
    pub(in crate::infra) fn require_account(
        &self,
        url: &url::Url,
        expected: &str,
    ) -> Result<(), String> {
        let saved = self
            .snapshot(url)?
            .ok_or("Sign in before connecting browser sync")?;
        if saved.account_id != expected {
            return Err("The native account does not match this workspace".into());
        }
        Ok(())
    }
    fn snapshot(&self, url: &url::Url) -> Result<Option<SavedCookies>, String> {
        let header = self.jar.cookies(url);
        let text = header.as_ref().and_then(|h| h.to_str().ok()).unwrap_or("");
        let values: HashMap<_, _> = text
            .split(';')
            .filter_map(|v| v.trim().split_once('='))
            .collect();
        let Some(refresh) = values.get("misty_refresh") else {
            return Ok(None);
        };
        let (subject, _) = identity(refresh, "refresh")?;
        let access = values.get("misty_session").map(|v| v.to_string());
        if let Some(access) = &access {
            if identity(access, "access")?.0 != subject {
                return Err("Account cookie mismatch".into());
            }
        }
        Ok(Some(SavedCookies {
            account_id: subject,
            origin: url.origin().ascii_serialization(),
            access,
            refresh: refresh.to_string(),
        }))
    }
    pub(in crate::infra) fn persist(&self, url: &url::Url) -> Result<Option<String>, String> {
        if let Some(saved) = self.snapshot(url)? {
            let encoded = zeroize::Zeroizing::new(
                serde_json::to_string(&saved).map_err(|_| "Could not encode account cookies")?,
            );
            credential_io(|| {
                misty_credential_store::account::store(&key(url, &saved.account_id), &encoded)
            })?;
            *self
                .account_id
                .lock()
                .map_err(|_| "Account cookie lock unavailable")? = Some(saved.account_id.clone());
            return Ok(Some(saved.account_id));
        }
        let mut account_id = self
            .account_id
            .lock()
            .map_err(|_| "Account cookie lock unavailable")?;
        if let Some(saved_account) = account_id.as_deref() {
            credential_io(|| misty_credential_store::account::delete(&key(url, saved_account)))?;
            *account_id = None;
        }
        Ok(None)
    }
    fn restore(url: &url::Url, account_id: &str, value: &str) -> Result<Option<Arc<Self>>, String> {
        let saved: SavedCookies =
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
        let client = Self::new()?;
        client.add(url, "misty_refresh", &saved.refresh, expiry);
        if let Some(access) = saved.access {
            let (subject, expiry) = identity(&access, "access")?;
            if subject != account_id {
                return Err("Saved access cookie account mismatch".into());
            }
            if expiry > now() {
                client.add(url, "misty_session", &access, expiry);
            }
        }
        *client
            .account_id
            .lock()
            .map_err(|_| "Account cookie lock unavailable")? = Some(account_id.to_owned());
        Ok(Some(client))
    }
    fn add(&self, url: &url::Url, name: &str, value: &str, expiry: u64) {
        let secure = if url.scheme() == "https" {
            "; Secure"
        } else {
            ""
        };
        self.jar.add_cookie_str(
            &format!(
                "{name}={value}; Path=/; HttpOnly; Max-Age={}{secure}",
                expiry.saturating_sub(now())
            ),
            url,
        );
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
        return Err("Invalid session cookie".into());
    }
    let payload = URL_SAFE_NO_PAD
        .decode(token.split('.').nth(1).unwrap_or_default())
        .map_err(|_| "Invalid session cookie")?;
    let claims: serde_json::Value =
        serde_json::from_slice(&payload).map_err(|_| "Invalid session cookie")?;
    if claims["token_use"].as_str() != Some(kind) {
        return Err("Invalid session cookie purpose".into());
    }
    let subject = claims["sub"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or("Missing session account")?;
    let expiry = claims["exp"].as_u64().ok_or("Missing session expiry")?;
    Ok((subject.to_owned(), expiry))
}

pub(in crate::infra) fn current(url: &url::Url) -> Result<Arc<AccountClient>, String> {
    let mut map = clients()
        .lock()
        .map_err(|_| "Account cookie lock unavailable")?;
    let origin = url.origin().ascii_serialization();
    if let Some(client) = map.get(&origin) {
        return Ok(client.clone());
    }
    let client = AccountClient::new()?;
    map.insert(origin, client.clone());
    Ok(client)
}
pub(super) fn activate(url: &url::Url, client: Arc<AccountClient>) -> Result<(), String> {
    clients()
        .lock()
        .map_err(|_| "Account cookie lock unavailable")?
        .insert(url.origin().ascii_serialization(), client);
    Ok(())
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

fn restore_preserves_scope(
    url: &url::Url,
    account: Option<&str>,
    scope: Option<&misty_browser_sync::crypto::VaultScope>,
) -> bool {
    has_active_account(url, account)
        && scope.is_none_or(|scope| {
            Some(scope.account_id.as_str()) == account
                && scope.deployment == url.as_str().trim_end_matches('/')
        })
}

#[cfg(test)]
mod tests;
