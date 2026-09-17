//! Native account cookie jars. Credentials never enter the renderer or WebKit.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::cookie::{CookieStore, Jar};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const SERVICE: &str = "com.misty.auth.cookies.v1";
static CLIENTS: OnceLock<Mutex<HashMap<String, Arc<AccountClient>>>> = OnceLock::new();

pub(super) struct AccountClient {
    pub http: reqwest::Client,
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

pub(super) fn server(raw: &str) -> Result<url::Url, String> {
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

impl AccountClient {
    pub(super) fn new() -> Result<Arc<Self>, String> {
        let jar = Arc::new(Jar::default());
        let http = reqwest::Client::builder()
            .cookie_provider(jar.clone())
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(90))
            .build()
            .map_err(|_| "Could not initialize account HTTP client")?;
        Ok(Arc::new(Self {
            http,
            jar,
            account_id: Mutex::new(None),
        }))
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
    pub(super) fn persist(&self, url: &url::Url) -> Result<Option<String>, String> {
        if let Some(saved) = self.snapshot(url)? {
            let encoded =
                serde_json::to_string(&saved).map_err(|_| "Could not encode account cookies")?;
            misty_credential_store::store(SERVICE, &key(url, &saved.account_id), &encoded)
                .map_err(|e| e.to_string())?;
            *self
                .account_id
                .lock()
                .map_err(|_| "Account cookie lock unavailable")? = Some(saved.account_id.clone());
            return Ok(Some(saved.account_id));
        }
        if let Some(account_id) = self
            .account_id
            .lock()
            .map_err(|_| "Account cookie lock unavailable")?
            .take()
        {
            misty_credential_store::delete(SERVICE, &key(url, &account_id))
                .map_err(|e| e.to_string())?;
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
// The native client decodes only to select a file and preserve expiry. Every
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

pub(super) fn current(url: &url::Url) -> Result<Arc<AccountClient>, String> {
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
#[tauri::command]
pub async fn auth_cookie_capture(
    api_base: String,
    account_id: Option<String>,
) -> Result<String, String> {
    let url = server(&api_base)?;
    let client = current(&url)?;
    let saved = client
        .snapshot(&url)?
        .ok_or("Misty session cookies are unavailable. Sign in again.")?;
    if account_id
        .as_deref()
        .is_some_and(|expected| expected != saved.account_id)
    {
        return Err("Session account changed during sign-in".into());
    }
    client.persist(&url)?;
    Ok(saved.account_id)
}
#[tauri::command]
pub async fn auth_cookie_restore(
    api_base: String,
    account_id: Option<String>,
) -> Result<bool, String> {
    let url = server(&api_base)?;
    activate(&url, AccountClient::new()?)?;
    let Some(account_id) = account_id.filter(|id| !id.is_empty()) else {
        return Ok(false);
    };
    let Some(value) = misty_credential_store::load(SERVICE, &key(&url, &account_id))
        .map_err(|e| e.to_string())?
    else {
        return Ok(false);
    };
    let Some(client) = AccountClient::restore(&url, &account_id, &value)? else {
        return Ok(false);
    };
    activate(&url, client)?;
    Ok(true)
}
#[tauri::command]
pub async fn auth_cookie_forget(api_base: String, account_id: String) -> Result<(), String> {
    let url = server(&api_base)?;
    misty_credential_store::delete(SERVICE, &key(&url, &account_id)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn token(user: &str, kind: &str, exp: u64) -> String {
        format!(
            "header.{}.signature",
            URL_SAFE_NO_PAD.encode(
                serde_json::to_vec(&serde_json::json!({"sub":user,"token_use":kind,"exp":exp}))
                    .unwrap()
            )
        )
    }
    #[test]
    fn restores_cookie_scope_and_expiry_without_exposing_credentials() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let url = server("https://api.misty.test/v1").unwrap();
        let saved = SavedCookies {
            account_id: "ada".into(),
            origin: url.origin().ascii_serialization(),
            access: Some(token("ada", "access", now() - 1)),
            refresh: token("ada", "refresh", now() + 3600),
        };
        let raw = serde_json::to_string(&saved).unwrap();
        let client = AccountClient::restore(&url, "ada", &raw).unwrap().unwrap();
        let snapshot = client.snapshot(&url).unwrap().unwrap();
        assert!(snapshot.access.is_none());
        assert_eq!(snapshot.account_id, "ada");
        assert!(client
            .jar
            .cookies(&server("https://other.test/v1").unwrap())
            .is_none());
        assert!(client
            .jar
            .cookies(&server("http://api.misty.test/v1").unwrap())
            .is_none());
        assert!(AccountClient::restore(&url, "grace", &raw).is_err());
        assert!(
            AccountClient::restore(&server("https://other.test/v1").unwrap(), "ada", &raw).is_err()
        );
    }
    #[test]
    fn rejects_expired_refresh_and_swapped_token_types() {
        let url = server("http://localhost:8081/v1").unwrap();
        let mut saved = SavedCookies {
            account_id: "ada".into(),
            origin: url.origin().ascii_serialization(),
            access: None,
            refresh: token("ada", "refresh", now() - 1),
        };
        assert!(
            AccountClient::restore(&url, "ada", &serde_json::to_string(&saved).unwrap())
                .unwrap()
                .is_none()
        );
        saved.refresh = token("ada", "access", now() + 3600);
        assert!(
            AccountClient::restore(&url, "ada", &serde_json::to_string(&saved).unwrap()).is_err()
        );
    }
}
