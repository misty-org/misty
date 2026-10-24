//! Opening the local database, its schema and the one-time name migration.
use super::*;

pub(super) fn connect(path: &Path) -> Result<Connection> {
    // The coordinator supplies a directory in native application data. Set
    // owner-only permissions at creation instead of fixing them after a write.
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|_| Error::Storage(rusqlite::Error::InvalidPath(path.into())))?;
    let connection = Connection::open(path)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    migrate_names(&connection)?;
    connection.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS sync_identity (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), scope BLOB NOT NULL,
            grant_json TEXT NOT NULL, device_key TEXT NOT NULL,
            next_counter INTEGER NOT NULL CHECK(next_counter>0),
            applied_sequence INTEGER NOT NULL CHECK(applied_sequence>=0), snapshot TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_outbox (
            operation_id TEXT PRIMARY KEY, device_counter INTEGER NOT NULL UNIQUE,
            mutation TEXT NOT NULL, accepted_sequence INTEGER UNIQUE
        );
        CREATE TABLE IF NOT EXISTS sync_local_intents (
            operation_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_discarded (
            operation_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, mutation TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_applied (
            sequence INTEGER PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, digest BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_browser_imports (
            profile_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0),
            journal TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_browser_capture (
            profile_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0),
            observation TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_browser_profiles (
            profile_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0),
            binding TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_high_watermark (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), observed_head INTEGER NOT NULL CHECK(observed_head>=0)
        );
        INSERT OR IGNORE INTO sync_high_watermark VALUES(1,0);
        CREATE TABLE IF NOT EXISTS sync_workspace_cache (
            workspace_id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version>=0), snapshot TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_workspace_desired (
            workspace_id TEXT PRIMARY KEY, desired TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_workspace_inflight (
            workspace_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, op TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_workspace_counter (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), next_counter INTEGER NOT NULL CHECK(next_counter>0)
        );
        INSERT OR IGNORE INTO sync_workspace_counter VALUES(1,1);
        CREATE TABLE IF NOT EXISTS sync_workspace_roster (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), roster TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_workspace_local (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), state TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_workspace_retired (
            id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
            retired_at INTEGER NOT NULL, desired TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_device_signin (
            workspace_id TEXT PRIMARY KEY, binding TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_collections (
            collection TEXT PRIMARY KEY, state TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_vault (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1),
            vault TEXT NOT NULL,
            bootstrap_pending INTEGER NOT NULL CHECK(bootstrap_pending IN (0,1)),
            enrollment_pending INTEGER NOT NULL CHECK(enrollment_pending IN (0,1))
        );",
    )?;
    Ok(connection)
}

/// Local schema version 1 renamed trees to workspaces, the sync workspace to
/// the vault and the records tier to collections. Stored JSON keeps loading
/// through serde aliases, except in-flight ops, which carry both the vault and
/// the workspace ID and are rewritten here.
fn migrate_names(connection: &Connection) -> Result<()> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version >= 1 {
        return Ok(());
    }
    let exists = |table: &str| -> Result<bool> {
        Ok(connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |row| row.get(0),
        )?)
    };
    let has_column = |table: &str, column: &str| -> Result<bool> {
        Ok(connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name=?2)",
            [table, column],
            |row| row.get(0),
        )?)
    };
    let tx = connection.unchecked_transaction()?;
    for (old, new) in [
        ("sync_tree_cache", "sync_workspace_cache"),
        ("sync_tree_desired", "sync_workspace_desired"),
        ("sync_tree_inflight", "sync_workspace_inflight"),
        ("sync_tree_counter", "sync_workspace_counter"),
        ("sync_tree_roster", "sync_workspace_roster"),
        ("sync_tree_local", "sync_workspace_local"),
        ("sync_tree_retired", "sync_workspace_retired"),
        ("sync_records", "sync_collections"),
    ] {
        if exists(old)? && !exists(new)? {
            tx.execute_batch(&format!("ALTER TABLE {old} RENAME TO {new}"))?;
        }
    }
    for table in [
        "sync_workspace_cache",
        "sync_workspace_desired",
        "sync_workspace_inflight",
        "sync_workspace_retired",
        "sync_device_signin",
    ] {
        if exists(table)? && has_column(table, "tree_id")? {
            tx.execute_batch(&format!(
                "ALTER TABLE {table} RENAME COLUMN tree_id TO workspace_id"
            ))?;
        }
    }
    if exists("sync_vault")? && has_column("sync_vault", "workspace")? {
        tx.execute_batch("ALTER TABLE sync_vault RENAME COLUMN workspace TO vault")?;
    }
    if exists("sync_workspace_inflight")? {
        let rows: Vec<(String, String)> = {
            let mut stmt = tx.prepare("SELECT workspace_id, op FROM sync_workspace_inflight")?;
            let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        for (workspace, op) in rows {
            let op = legacy_op(serde_json::from_str(&op)?);
            tx.execute(
                "UPDATE sync_workspace_inflight SET op=?2 WHERE workspace_id=?1",
                [workspace, serde_json::to_string(&op)?],
            )?;
        }
    }
    tx.execute_batch("PRAGMA user_version=1")?;
    tx.commit()?;
    Ok(())
}

/// A pre-rename op: `workspace_id` was the vault and `tree_id` the workspace.
fn legacy_op(mut op: serde_json::Value) -> serde_json::Value {
    let Some(object) = op.as_object_mut() else {
        return op;
    };
    if let Some(tree) = object.remove("tree_id") {
        if let Some(vault) = object.remove("workspace_id") {
            object.insert("vault_id".into(), vault);
        }
        object.insert("workspace_id".into(), tree);
    }
    if let Some(base) = object.remove("base_tree_version") {
        object.insert("base_workspace_version".into(), base);
    }
    op
}
