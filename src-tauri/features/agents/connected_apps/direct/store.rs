//! The person's direct app connections, tokens and all, in the OS keychain: one item per Misty
//! account on this computer, never synced and never sent anywhere but the app that issued them.
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};

use super::super::SIGNED_OUT;

const SERVICE: &str = "com.misty.app-connections";

/// One sign-in to one app's own MCP server.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct Connection {
    pub id: String,
    /// The short name tools are filed under, unique among this account's connections: `notion`.
    pub app: String,
    pub name: String,
    pub url: String,
    /// The OAuth client the app registered for this sign-in, and its secret when it issued one.
    pub client_id: String,
    pub client_secret: Option<String>,
    pub token_endpoint: String,
    pub resource: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Unix seconds; None when the app didn't say.
    pub expires_at: Option<i64>,
    pub created_at: String,
}

/// What a page may see of a connection: never a token.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ConnectionView {
    pub id: String,
    pub app: String,
    pub name: String,
    pub url: String,
    pub created_at: String,
}

impl Connection {
    pub fn view(&self) -> ConnectionView {
        ConnectionView {
            id: self.id.clone(),
            app: self.app.clone(),
            name: self.name.clone(),
            url: self.url.clone(),
            created_at: self.created_at.clone(),
        }
    }
}

fn entry(account: &str) -> String {
    if account.is_empty() || account == SIGNED_OUT {
        "local".to_owned()
    } else {
        format!("account:{account}")
    }
}

/// Reads and writes of one account's list never interleave.
static LOCK: Mutex<()> = Mutex::new(());

fn read(account: &str) -> Result<Vec<Connection>, String> {
    let raw = crate::account::credential_store::load(SERVICE, &entry(account))
        .map_err(|_| "Misty couldn't read this computer's app connections.".to_owned())?;
    Ok(raw
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default())
}

fn write(account: &str, connections: &[Connection]) -> Result<(), String> {
    let failed = || "Misty couldn't save this app connection to the keychain.".to_owned();
    if connections.is_empty() {
        return crate::account::credential_store::delete(SERVICE, &entry(account))
            .map_err(|_| failed());
    }
    let text = serde_json::to_string(connections).map_err(|_| failed())?;
    crate::account::credential_store::store(SERVICE, &entry(account), &text).map_err(|_| failed())
}

/// Blocking: the keychain may prompt. Call from `spawn_blocking`.
pub fn list(account: &str) -> Result<Vec<Connection>, String> {
    let _held = LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    read(account)
}

/// Changes the list under the lock and returns what it became. Blocking, like `list`.
pub fn update<T>(
    account: &str,
    change: impl FnOnce(&mut Vec<Connection>) -> T,
) -> Result<(T, Vec<Connection>), String> {
    let _held = LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let mut connections = read(account)?;
    let answer = change(&mut connections);
    write(account, &connections)?;
    Ok((answer, connections))
}

/// `notion`, or `notion2` when the account already has a `notion` from another server.
pub fn unique_app(connections: &[Connection], wanted: &str, url: &str) -> String {
    let taken = |name: &str| {
        connections
            .iter()
            .any(|item| item.app == name && item.url != url)
    };
    if !taken(wanted) {
        return wanted.to_owned();
    }
    (2..)
        .map(|n| format!("{wanted}{n}"))
        .find(|name| !taken(name))
        .unwrap_or_else(|| wanted.to_owned())
}

pub async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| "Misty couldn't reach the keychain.".to_owned())?
}
