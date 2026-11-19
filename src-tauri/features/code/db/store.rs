//! The database connections the person saved, kept for this device only. Each account's list is
//! one `grant:` row in `settings_state` (like the "Open in" programs, `project/open_app/custom.rs`):
//! windows can neither read nor write a `grant:` scope through `profile_state`, so a SQLite path
//! here was always checked by `code_db_save` first. Postgres passwords live in the credential
//! store (sealed in `misty.db` under the keychain's master key), never in this row.

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use database::store::Store;

/// The credential-store service the passwords are kept under, one entry per account and
/// connection. They stay on this computer and are sent only to that connection's server.
const PASSWORD_SERVICE: &str = "com.misty.code-databases";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    Sqlite,
    Postgres,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteTarget {
    pub path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SslMode {
    Disable,
    Prefer,
    Require,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostgresTarget {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub ssl_mode: SslMode,
}

/// A connection as the window sends and shows it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub kind: DbKind,
    #[serde(default)]
    pub sqlite: Option<SqliteTarget>,
    #[serde(default)]
    pub postgres: Option<PostgresTarget>,
}

/// A saved connection: what the window sees, and what only native code keeps.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    #[serde(flatten)]
    pub connection: Connection,
    /// A password is in the credential store. The window gets this, never the password.
    #[serde(default)]
    pub has_password: bool,
    /// The SQLite file was picked in the system's dialog rather than found in a linked folder,
    /// so its grant is renewed from this record after Misty restarts (see `sqlite::open`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub picked: bool,
}

/// What the window is told about a saved connection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    #[serde(flatten)]
    pub connection: Connection,
    pub has_password: bool,
}

impl From<&Saved> for ConnectionInfo {
    fn from(saved: &Saved) -> Self {
        Self {
            connection: saved.connection.clone(),
            has_password: saved.has_password,
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Document {
    #[serde(default)]
    connections: Vec<Saved>,
}

fn scope(account: &str) -> String {
    format!("grant:code-db-connections:{account}")
}

fn failed(_: impl std::fmt::Display) -> String {
    "Misty couldn't read its saved connections.".to_string()
}

fn read(store: &Store, account: &str) -> Result<Document, String> {
    let connection = store.connect().map_err(failed)?;
    let row: Option<String> = connection
        .query_row(
            "SELECT document FROM settings_state WHERE scope = ?1",
            [scope(account)],
            |row| row.get(0),
        )
        .optional()
        .map_err(failed)?;
    Ok(row
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default())
}

fn write(store: &Store, account: &str, document: &Document) -> Result<(), String> {
    let saving = |_| "Misty couldn't save the connection.".to_string();
    let text = serde_json::to_string(document).map_err(|error| saving(error.to_string()))?;
    store
        .connect()
        .map_err(|error| saving(error.to_string()))?
        .execute(
            "INSERT INTO settings_state (scope, revision, document) VALUES (?1, 1, ?2)
             ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, document = excluded.document",
            rusqlite::params![scope(account), text],
        )
        .map(|_| ())
        .map_err(|error| saving(error.to_string()))
}

pub fn list(store: &Store, account: &str) -> Result<Vec<Saved>, String> {
    Ok(read(store, account)?.connections)
}

pub fn find(store: &Store, account: &str, id: &str) -> Result<Saved, String> {
    read(store, account)?
        .connections
        .into_iter()
        .find(|saved| saved.connection.id == id)
        .ok_or_else(|| "That connection isn't saved any more.".to_string())
}

/// Adds `saved`, or replaces the one with its id, keeping the list's order.
pub fn put(store: &Store, account: &str, saved: Saved) -> Result<(), String> {
    let mut document = read(store, account)?;
    match document
        .connections
        .iter_mut()
        .find(|existing| existing.connection.id == saved.connection.id)
    {
        Some(existing) => *existing = saved,
        None => document.connections.push(saved),
    }
    write(store, account, &document)
}

pub fn remove(store: &Store, account: &str, id: &str) -> Result<(), String> {
    let mut document = read(store, account)?;
    document
        .connections
        .retain(|saved| saved.connection.id != id);
    write(store, account, &document)
}

fn password_entry(account: &str, id: &str) -> String {
    format!("{account}:{id}")
}

pub fn load_password(
    account: &str,
    id: &str,
) -> Result<Option<zeroize::Zeroizing<String>>, String> {
    crate::account::credential_store::load(PASSWORD_SERVICE, &password_entry(account, id))
        .map(|value| value.map(zeroize::Zeroizing::new))
        .map_err(|_| "The password couldn't be read from the keychain.".to_string())
}

pub fn store_password(account: &str, id: &str, password: &str) -> Result<(), String> {
    crate::account::credential_store::store(
        PASSWORD_SERVICE,
        &password_entry(account, id),
        password,
    )
    .map_err(|_| "The password couldn't be saved to the keychain.".to_string())
}

pub fn delete_password(account: &str, id: &str) -> Result<(), String> {
    crate::account::credential_store::delete(PASSWORD_SERVICE, &password_entry(account, id))
        .map_err(|_| "The password couldn't be removed from the keychain.".to_string())
}
