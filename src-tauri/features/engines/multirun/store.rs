// The worktrees multi-run made, kept in `misty.db` on this computer only. A row is what lets an
// engine's turn run in a worktree: nothing else can add a folder to this table.

use std::path::{Path, PathBuf};

use database::store::Store;

/// One agent's lane of a multi-run: its worktree, and the chat its turn runs in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    pub account: String,
    pub multirun: String,
    pub lane: i64,
    pub space: String,
    /// The linked folder the worktree was made from.
    pub folder: String,
    /// The worktree itself.
    pub path: String,
    pub branch: String,
    /// The commit every lane started from.
    pub base: String,
    pub agent: String,
    pub conversation: String,
    pub task: String,
    pub kept: bool,
    pub created_at: i64,
}

const COLUMNS: &str = "account, multirun, lane, space, folder, path, branch, base, agent, \
                       conversation, task, kept, created_at";

fn text(error: rusqlite::Error) -> String {
    error.to_string()
}

fn read(row: &rusqlite::Row) -> rusqlite::Result<Row> {
    Ok(Row {
        account: row.get(0)?,
        multirun: row.get(1)?,
        lane: row.get(2)?,
        space: row.get(3)?,
        folder: row.get(4)?,
        path: row.get(5)?,
        branch: row.get(6)?,
        base: row.get(7)?,
        agent: row.get(8)?,
        conversation: row.get(9)?,
        task: row.get(10)?,
        kept: row.get(11)?,
        created_at: row.get(12)?,
    })
}

pub fn insert(store: &Store, rows: &[Row]) -> Result<(), String> {
    let mut connection = store.connect().map_err(text)?;
    let transaction = connection.transaction().map_err(text)?;
    for row in rows {
        transaction
            .execute(
                &format!(
                    "INSERT INTO multirun_worktrees ({COLUMNS})
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)"
                ),
                rusqlite::params![
                    row.account,
                    row.multirun,
                    row.lane,
                    row.space,
                    row.folder,
                    row.path,
                    row.branch,
                    row.base,
                    row.agent,
                    row.conversation,
                    row.task,
                    row.kept,
                    row.created_at,
                ],
            )
            .map_err(text)?;
    }
    transaction.commit().map_err(text)
}

fn select(store: &Store, filter: &str, values: &[&str]) -> Result<Vec<Row>, String> {
    let connection = store.connect().map_err(text)?;
    let mut statement = connection
        .prepare(&format!(
            "SELECT {COLUMNS} FROM multirun_worktrees WHERE {filter}
             ORDER BY created_at DESC, multirun, lane"
        ))
        .map_err(text)?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(values), read)
        .map_err(text)?;
    rows.collect::<Result<_, _>>().map_err(text)
}

/// A Space's multi-runs, newest first, each one's lanes in order.
pub fn of_space(store: &Store, account: &str, space: &str) -> Result<Vec<Row>, String> {
    select(store, "account = ?1 AND space = ?2", &[account, space])
}

/// One multi-run's lanes, in order. Empty when the account has no such multi-run.
pub fn of_run(store: &Store, account: &str, multirun: &str) -> Result<Vec<Row>, String> {
    select(
        store,
        "account = ?1 AND multirun = ?2",
        &[account, multirun],
    )
}

/// Whether multi-run made exactly this folder as a worktree for this account.
pub fn is_worktree(store: &Store, account: &str, folder: &Path) -> bool {
    let Some(folder) = folder.to_str() else {
        return false;
    };
    store
        .connect()
        .and_then(|connection| {
            connection.query_row(
                "SELECT EXISTS (SELECT 1 FROM multirun_worktrees WHERE account = ?1 AND path = ?2)",
                [account, folder],
                |row| row.get::<_, bool>(0),
            )
        })
        .unwrap_or(false)
}

/// Every worktree on this computer, to let the file gate reach them as the app starts.
pub fn all_paths(store: &Store) -> Vec<PathBuf> {
    let read = || -> rusqlite::Result<Vec<PathBuf>> {
        let connection = store.connect()?;
        let mut statement = connection.prepare("SELECT path FROM multirun_worktrees")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| row.map(PathBuf::from)).collect()
    };
    read().unwrap_or_default()
}

pub fn mark_kept(store: &Store, account: &str, multirun: &str, lane: i64) -> Result<(), String> {
    store
        .connect()
        .map_err(text)?
        .execute(
            "UPDATE multirun_worktrees SET kept = 1
             WHERE account = ?1 AND multirun = ?2 AND lane = ?3",
            rusqlite::params![account, multirun, lane],
        )
        .map(|_| ())
        .map_err(text)
}

pub fn delete(store: &Store, account: &str, multirun: &str) -> Result<(), String> {
    store
        .connect()
        .map_err(text)?
        .execute(
            "DELETE FROM multirun_worktrees WHERE account = ?1 AND multirun = ?2",
            [account, multirun],
        )
        .map(|_| ())
        .map_err(text)
}
