//! The Code page's databases: SQLite files and Postgres servers the person saved on this device,
//! their schemas, queries and row edits.
//!
//! A SQLite file must be in a folder the account linked (`crate::project::linked_path`) or one the
//! person picked in the system's dialog (`code_db_pick_sqlite`); the file gate refuses any other.
//! Postgres passwords stay in the credential store and never reach the window, `misty.db`'s
//! settings or an error. A running query stops through `code_db_cancel`: Postgres's cancel request,
//! SQLite's interrupt.

mod access;
mod pg_pool;
mod pg_values;
mod postgres;
mod running;
mod sqlite;
mod store;
mod types;

use std::time::Instant;

use serde_json::{Map, Value};

use crate::project::person_window;

use access::{
    blocking, misty_store, normalize, refuse_misty_data, saved_connection, saved_postgres,
    saved_sqlite, sqlite_file, sqlite_standing, BROKEN,
};
use running::{running_key, RunGuard, Stopper};
use store::{Connection, ConnectionInfo, DbKind, PostgresTarget, Saved};
use types::{DbSchema, QueryResult, TableRef};

/// Rows a query returns when the window doesn't say, and the most it may ask for.
const DEFAULT_LIMIT: u32 = 500;
const MOST_ROWS: u32 = 10_000;

// ---------------------------------------------------------------------------------------------
// Commands

/// The connections saved on this device for this account.
#[tauri::command]
pub async fn code_db_list(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
) -> Result<Vec<ConnectionInfo>, String> {
    person_window(&webview)?;
    let store = misty_store(&app);
    let saved = blocking(move || store::list(&store, &account)).await?;
    Ok(saved.iter().map(ConnectionInfo::from).collect())
}

/// Saves a new connection (no id) or changes one. `password`, for Postgres, replaces the saved
/// one; "" removes it; leaving it out keeps it.
#[tauri::command]
pub async fn code_db_save(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    connection: Connection,
    password: Option<String>,
) -> Result<ConnectionInfo, String> {
    person_window(&webview)?;
    let mut connection = normalize(connection)?;
    let store = misty_store(&app);
    let existing = if connection.id.is_empty() {
        connection.id = uuid::Uuid::new_v4().to_string();
        None
    } else {
        let (store, account, id) = (store.clone(), account.clone(), connection.id.clone());
        Some(blocking(move || store::find(&store, &account, &id)).await?)
    };

    let mut picked = false;
    if let Some(target) = &connection.sqlite {
        picked = sqlite_standing(&app, &account, &target.path, existing.as_ref()).await?;
        sqlite_file(&app, &account, &target.path, picked).await?;
    }

    let had_password = existing.as_ref().is_some_and(|saved| saved.has_password);
    let saved = blocking(move || {
        let id = connection.id.clone();
        let has_password = match (connection.kind, password.as_deref()) {
            (DbKind::Postgres, Some("")) => {
                store::delete_password(&account, &id)?;
                false
            }
            (DbKind::Postgres, Some(password)) => {
                store::store_password(&account, &id, password)?;
                true
            }
            (DbKind::Postgres, None) => had_password,
            // A connection turned into SQLite needs no password any more.
            (DbKind::Sqlite, _) => {
                if had_password {
                    store::delete_password(&account, &id)?;
                }
                false
            }
        };
        let saved = Saved {
            connection,
            has_password,
            picked,
        };
        store::put(&store, &account, saved.clone())?;
        Ok((saved, account))
    })
    .await?;
    let (saved, account) = saved;
    // Clients opened with the old details or password go.
    postgres::forget(&account, &saved.connection.id);
    Ok(ConnectionInfo::from(&saved))
}

/// Removes a saved connection and its password.
#[tauri::command]
pub async fn code_db_remove(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    id: String,
) -> Result<(), String> {
    person_window(&webview)?;
    postgres::forget(&account, &id);
    let store = misty_store(&app);
    blocking(move || {
        store::remove(&store, &account, &id)?;
        store::delete_password(&account, &id)
    })
    .await
}

/// Tries a connection as the dialog has it, saved or not. `password` is the one typed in the
/// dialog; without it a saved connection uses its saved one.
#[tauri::command]
pub async fn code_db_test(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    connection: Connection,
    password: Option<String>,
) -> Result<(), String> {
    person_window(&webview)?;
    let connection = normalize(connection)?;
    let existing = if connection.id.is_empty() {
        None
    } else {
        saved_connection(&app, &account, &connection.id).await.ok()
    };
    match connection.kind {
        DbKind::Sqlite => {
            let path = connection.sqlite.as_ref().ok_or(BROKEN)?.path.clone();
            let picked = sqlite_standing(&app, &account, &path, existing.as_ref()).await?;
            let file = sqlite_file(&app, &account, &path, picked).await?;
            blocking(move || sqlite::test(&sqlite::open(&file)?)).await
        }
        DbKind::Postgres => {
            let target: PostgresTarget = connection.postgres.clone().ok_or(BROKEN)?;
            let password = match password.filter(|typed| !typed.is_empty()) {
                Some(typed) => Some(zeroize::Zeroizing::new(typed)),
                None if existing.as_ref().is_some_and(|saved| saved.has_password) => {
                    let (owner, id) = (account.clone(), connection.id.clone());
                    blocking(move || store::load_password(&owner, &id)).await?
                }
                None => None,
            };
            let client =
                postgres::connect(&target, password.as_deref().map(String::as_str)).await?;
            client
                .simple_query("SELECT 1")
                .await
                .map(|_| ())
                .map_err(|error| postgres::error_text(&error))
        }
    }
}

/// Picks a SQLite file in the system's dialog and grants it until Misty quits; saving a connection
/// to it keeps the grant (see `sqlite_file`). Nothing when the person cancels.
#[tauri::command]
pub async fn code_db_pick_sqlite(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    person_window(&webview)?;
    let _ = account;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a SQLite database")
        .pick_file(move |file| {
            let _ = send.send(file);
        });
    let Some(file) = receive.await.ok().flatten() else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| "Choose a file on this computer.".to_string())?;
    refuse_misty_data(&app, &path)?;
    file_access::allow_picked_file(&path, file_access::Access::Write);
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// The connection's schemas, tables and views, with each column's type, nullability and whether
/// it is in the primary key.
#[tauri::command]
pub async fn code_db_schema(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    id: String,
) -> Result<DbSchema, String> {
    person_window(&webview)?;
    let saved = saved_connection(&app, &account, &id).await?;
    match saved.connection.kind {
        DbKind::Sqlite => {
            let file = saved_sqlite(&app, &account, &saved).await?;
            blocking(move || sqlite::schema(&sqlite::open(&file)?)).await
        }
        DbKind::Postgres => {
            let mut lease = saved_postgres(&account, &saved).await?;
            postgres::schema(lease.client()).await
        }
    }
}

/// Runs `sql`, one statement or a script, and returns the last result set's first `limit` rows
/// (500 unless asked). `queryId` names the run for `code_db_cancel`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn code_db_query(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    id: String,
    sql: String,
    limit: Option<u32>,
    query_id: Option<String>,
) -> Result<QueryResult, String> {
    person_window(&webview)?;
    if sql.trim().is_empty() {
        return Err("Write a query to run.".into());
    }
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MOST_ROWS) as usize;
    let window = webview.label().to_string();
    let key = query_id
        .as_deref()
        .map(|query| running_key(&account, query));
    let saved = saved_connection(&app, &account, &id).await?;
    let started = Instant::now();
    let mut result = match saved.connection.kind {
        DbKind::Sqlite => {
            let file = saved_sqlite(&app, &account, &saved).await?;
            blocking(move || {
                let connection = sqlite::open(&file)?;
                let _running = RunGuard::start(
                    key,
                    &window,
                    Stopper::Sqlite(connection.get_interrupt_handle()),
                );
                sqlite::query(&connection, &sql, limit)
            })
            .await?
        }
        DbKind::Postgres => {
            let mut lease = saved_postgres(&account, &saved).await?;
            let _running = RunGuard::start(key, &window, Stopper::Postgres(lease.cancel_token()));
            postgres::query(&mut lease, &sql, limit).await?
        }
    };
    result.elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    Ok(result)
}

/// Stops a query this window started. Nothing happens when it has already finished.
#[tauri::command]
pub async fn code_db_cancel(
    webview: tauri::Webview,
    account: String,
    query_id: String,
) -> Result<(), String> {
    person_window(&webview)?;
    if let Some(token) = running::stop(&running_key(&account, &query_id), webview.label()) {
        postgres::cancel(token).await;
    }
    Ok(())
}

/// Changes one row of `table`, found by its primary key values in `key`, setting the columns in
/// `changes`. It commits only when exactly one row changed, and refuses a table without a key.
#[tauri::command]
pub async fn code_db_update_row(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    id: String,
    table: TableRef,
    key: Map<String, Value>,
    changes: Map<String, Value>,
) -> Result<(), String> {
    person_window(&webview)?;
    let saved = saved_connection(&app, &account, &id).await?;
    match saved.connection.kind {
        DbKind::Sqlite => {
            let file = saved_sqlite(&app, &account, &saved).await?;
            blocking(move || {
                let mut connection = sqlite::open(&file)?;
                sqlite::update_row(&mut connection, &table, &key, &changes)
            })
            .await
        }
        DbKind::Postgres => {
            let mut lease = saved_postgres(&account, &saved).await?;
            postgres::update_row(&mut lease, &table, &key, &changes).await
        }
    }
}
