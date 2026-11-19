//! How a window's connection reaches its database: the checks on a connection's details, where a
//! SQLite file may be, and the saved connection's file or Postgres client.

use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::app::runtime::MistyRuntime;
use crate::project::linked_path;

use super::postgres;
use super::store::{self, Connection, DbKind, Saved, SqliteTarget};

pub(super) const OUT_OF_REACH: &str =
    "Choose a database file in one of this Space's linked folders, or pick it with Choose file.";
pub(super) const BROKEN: &str =
    "This connection is missing its details. Edit it and save it again.";

pub(super) fn misty_store(app: &tauri::AppHandle) -> database::store::Store {
    app.state::<MistyRuntime>().environment.store()
}

pub(super) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| "Something went wrong. Try again.".to_string())?
}

/// A connection with its text trimmed and only its own kind's details, or what's missing.
pub(super) fn normalize(mut connection: Connection) -> Result<Connection, String> {
    connection.name = connection.name.trim().to_string();
    if connection.name.is_empty() {
        return Err("Give the connection a name.".into());
    }
    if connection.name.chars().count() > 100 {
        return Err("That name is too long.".into());
    }
    match connection.kind {
        DbKind::Sqlite => {
            let path = connection
                .sqlite
                .take()
                .map(|target| target.path.trim().to_string())
                .unwrap_or_default();
            if path.is_empty() {
                return Err("Choose a database file.".into());
            }
            connection.sqlite = Some(SqliteTarget { path });
            connection.postgres = None;
        }
        DbKind::Postgres => {
            let mut target = connection
                .postgres
                .take()
                .ok_or("Fill in the server's details.")?;
            target.host = target.host.trim().to_string();
            target.database = target.database.trim().to_string();
            target.user = target.user.trim().to_string();
            if target.host.is_empty() {
                return Err("Enter the server's host.".into());
            }
            if target.port == 0 {
                return Err("Enter a port between 1 and 65535.".into());
            }
            if target.database.is_empty() {
                return Err("Enter the database's name.".into());
            }
            if target.user.is_empty() {
                return Err("Enter the user to connect as.".into());
            }
            connection.postgres = Some(target);
            connection.sqlite = None;
        }
    }
    Ok(connection)
}

/// Misty's own data, `misty.db` among it, is never opened as a person's database, even from a
/// linked folder that holds it.
pub(super) fn refuse_misty_data(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let root = app.state::<MistyRuntime>().environment.misty_root();
    let real_root = file_access::fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    if path.starts_with(&root) || path.starts_with(&real_root) {
        return Err("That file is Misty's own data and can't be opened here.".into());
    }
    Ok(())
}

/// Whether a SQLite file the window names may be saved, and how it is reached: `false` when it
/// lies in a linked folder, `true` when the person picked it. A file picked before Misty last
/// started keeps that standing for the connection that saved it.
pub(super) async fn sqlite_standing(
    app: &tauri::AppHandle,
    account: &str,
    path: &str,
    existing: Option<&Saved>,
) -> Result<bool, String> {
    if linked_path(app, account, path).await.is_ok() {
        return Ok(false);
    }
    let picked_before = existing.is_some_and(|saved| {
        saved.picked
            && saved
                .connection
                .sqlite
                .as_ref()
                .map(|target| target.path.as_str())
                == Some(path)
    });
    if picked_before || file_access::is_picked_file(Path::new(path)) {
        return Ok(true);
    }
    Err(OUT_OF_REACH.into())
}

/// The file to open for a SQLite connection, checked again each time: a linked folder may have
/// been unlinked since. A picked file's grant is renewed from the saved record, which only
/// `code_db_save` writes, after the dialog granted it (the gate forgets picks when Misty quits).
pub(super) async fn sqlite_file(
    app: &tauri::AppHandle,
    account: &str,
    path: &str,
    picked: bool,
) -> Result<PathBuf, String> {
    let resolved = if picked {
        let path = PathBuf::from(path);
        file_access::allow_picked_file(&path, file_access::Access::Write);
        path
    } else {
        linked_path(app, account, path)
            .await
            .map_err(|_| OUT_OF_REACH.to_string())?
    };
    refuse_misty_data(app, &resolved)?;
    if !file_access::fs::is_file(&resolved) {
        return Err("There's no database file at that path.".into());
    }
    Ok(resolved)
}

pub(super) async fn saved_connection(
    app: &tauri::AppHandle,
    account: &str,
    id: &str,
) -> Result<Saved, String> {
    let store = misty_store(app);
    let (account, id) = (account.to_string(), id.to_string());
    blocking(move || store::find(&store, &account, &id)).await
}

pub(super) async fn saved_sqlite(
    app: &tauri::AppHandle,
    account: &str,
    saved: &Saved,
) -> Result<PathBuf, String> {
    let target = saved.connection.sqlite.as_ref().ok_or(BROKEN)?;
    sqlite_file(app, account, &target.path, saved.picked).await
}

pub(super) async fn saved_postgres(
    account: &str,
    saved: &Saved,
) -> Result<postgres::Lease, String> {
    let target = saved.connection.postgres.as_ref().ok_or(BROKEN)?;
    let (owner, id, has_password) = (
        account.to_string(),
        saved.connection.id.clone(),
        saved.has_password,
    );
    postgres::lease(account, &saved.connection.id, target, move || {
        if has_password {
            store::load_password(&owner, &id)
        } else {
            Ok(None)
        }
    })
    .await
}
