// Connections a person makes so an agent Misty doesn't start (Cursor, the Claude app, any MCP
// client on this computer) can use one of their Spaces through Misty's local MCP server.
//
// A connection is a name and a token for one Space. The token is shown once and only its hash
// is kept. A connected agent always works in Ask: it reads freely and every change it wants
// goes to the person first, decided by the same native gate as any other tool call.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use database::store::Store;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Manager, State};

use crate::app::runtime::MistyRuntime;

/// A connection as the person sees it in the list.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    #[serde(skip)]
    pub account: String,
    #[serde(skip)]
    pub space: String,
}

/// What creating one gives back: the only time the token is ever shown.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    id: String,
    name: String,
    url: String,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    /// The server's address on this computer, or nothing while it could not start.
    url: Option<String>,
    connections: Vec<Connection>,
}

/// Every connection on this computer by its token's hash, so a call is placed without a query.
static BY_HASH: LazyLock<Mutex<HashMap<String, Connection>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn by_hash() -> std::sync::MutexGuard<'static, HashMap<String, Connection>> {
    BY_HASH
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn text(error: rusqlite::Error) -> String {
    error.to_string()
}

fn read_all(store: &Store) -> Result<Vec<(String, Connection)>, String> {
    let connection = store.connect().map_err(text)?;
    let mut statement = connection
        .prepare("SELECT token_hash, id, account, space, name, created_at FROM space_connections")
        .map_err(text)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                Connection {
                    id: row.get(1)?,
                    account: row.get(2)?,
                    space: row.get(3)?,
                    name: row.get(4)?,
                    created_at: row.get(5)?,
                },
            ))
        })
        .map_err(text)?;
    rows.collect::<Result<_, _>>().map_err(text)
}

/// Loads the connections and starts the server if there is one to serve. Runs as the app starts.
pub async fn start(app: tauri::AppHandle) {
    let store = app.state::<MistyRuntime>().environment.store();
    let Ok(Ok(all)) = tokio::task::spawn_blocking(move || read_all(&store)).await else {
        return;
    };
    if all.is_empty() {
        return;
    }
    by_hash().extend(all);
    let _ = super::mcp::address(&app).await;
}

/// The connection a token belongs to.
pub(crate) fn of_token(token: &str) -> Option<Connection> {
    by_hash().get(&hash(token)).cloned()
}

/// The id a connection's calls are journaled and gated under.
pub(crate) fn run_id(connection: &Connection) -> String {
    format!("connection_{}", connection.id)
}

/// What the tool gate reads for a connection's calls: whose it is, and that it always asks.
pub(crate) fn request_of(run_id: &str) -> Option<Value> {
    let id = run_id.strip_prefix("connection_")?;
    let held = by_hash();
    let connection = held.values().find(|connection| connection.id == id)?;
    Some(json!({ "account": connection.account, "permission_mode": "ask" }))
}

fn person_window(webview: &tauri::Webview) -> Result<(), String> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err("Only a profile's window can do this.".into())
    }
}

#[tauri::command]
pub async fn space_connection_list(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    space: String,
) -> Result<Listed, String> {
    person_window(&webview)?;
    let mut connections: Vec<Connection> = by_hash()
        .values()
        .filter(|connection| connection.account == account && connection.space == space)
        .cloned()
        .collect();
    connections.sort_by_key(|connection| connection.created_at);
    Ok(Listed {
        url: super::mcp::address(&app).await,
        connections,
    })
}

/// Makes a connection to a Space and returns its token, which is never shown again.
#[tauri::command]
pub async fn space_connection_create(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    space: String,
    name: String,
) -> Result<Created, String> {
    person_window(&webview)?;
    let name = name.trim().to_string();
    if name.is_empty() || name.chars().count() > 80 || space.len() > 200 {
        return Err("Give the connection a short name.".into());
    }
    let url = super::mcp::address(&app)
        .await
        .ok_or("Misty's server for agents could not start on this computer.")?;
    let token = format!(
        "misty_{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let made = Connection {
        id: uuid::Uuid::new_v4().simple().to_string(),
        name: name.clone(),
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as i64),
        account,
        space,
    };
    let (store, kept, token_hash) = (state.environment.store(), made.clone(), hash(&token));
    let saved_hash = token_hash.clone();
    tokio::task::spawn_blocking(move || {
        store
            .connect()
            .map_err(text)?
            .execute(
                "INSERT INTO space_connections (id, account, space, name, token_hash, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    kept.id,
                    kept.account,
                    kept.space,
                    kept.name,
                    saved_hash,
                    kept.created_at
                ],
            )
            .map(|_| ())
            .map_err(text)
    })
    .await
    .map_err(|error| error.to_string())??;
    by_hash().insert(token_hash, made.clone());
    Ok(Created {
        id: made.id,
        name,
        url,
        token,
    })
}

/// Ends a connection: its token stops working at once.
#[tauri::command]
pub async fn space_connection_revoke(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    id: String,
) -> Result<(), String> {
    person_window(&webview)?;
    by_hash().retain(|_, connection| !(connection.id == id && connection.account == account));
    let store = state.environment.store();
    tokio::task::spawn_blocking(move || {
        store
            .connect()
            .map_err(text)?
            .execute(
                "DELETE FROM space_connections WHERE id = ?1 AND account = ?2",
                [id, account],
            )
            .map(|_| ())
            .map_err(text)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_connection_always_asks_and_is_found_only_by_its_own_token() {
        let made = Connection {
            id: "c1".into(),
            name: "Cursor".into(),
            created_at: 1,
            account: "me".into(),
            space: "s1".into(),
        };
        by_hash().insert(hash("misty_secret"), made.clone());
        assert_eq!(
            of_token("misty_secret").map(|found| found.id),
            Some("c1".into())
        );
        assert!(of_token("misty_other").is_none());
        let request = request_of(&run_id(&made)).unwrap();
        assert_eq!(request["account"], "me");
        assert_eq!(request["permission_mode"], "ask");
        assert!(request_of("invocation_x").is_none());
    }
}
