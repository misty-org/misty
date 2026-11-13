//! Answers in `settings_state`. Only this folder writes these scopes: `profile_state`, which windows
//! can reach, refuses them (`is_protected_scope`), so a window can't grant itself anything.
use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Manager};

use crate::Backing;

pub(super) fn read_answer(connection: &Connection, scope: &str) -> rusqlite::Result<bool> {
    let document: Option<String> = connection
        .query_row(
            "SELECT document FROM settings_state WHERE scope = ?1",
            [scope],
            |row| row.get(0),
        )
        .optional()?;
    Ok(document.as_deref() == Some("true"))
}

pub(super) fn write_answer(connection: &Connection, scope: &str, on: bool) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO settings_state (scope, revision, document) VALUES (?1, 1, ?2)
         ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, document = excluded.document",
        params![scope, if on { "true" } else { "false" }],
    )?;
    Ok(())
}

fn connect(app: &AppHandle) -> Option<Connection> {
    let backing = app.try_state::<Backing>()?;
    backing.0.connect().ok()
}

/// Off when the database can't answer: a failure must never read as a yes.
pub(super) fn read(app: &AppHandle, scope: &str) -> bool {
    connect(app).is_some_and(|connection| read_answer(&connection, scope).unwrap_or(false))
}

pub(super) fn write(app: &AppHandle, scope: &str, on: bool) {
    let saved = connect(app).is_some_and(|connection| write_answer(&connection, scope, on).is_ok());
    if !saved {
        eprintln!("Could not save the answer for {scope}.");
    }
}
