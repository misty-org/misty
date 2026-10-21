//! Misty's database: `~/.misty/.local/data/misty.db`, the one place structured data lives.
//! Every store (settings, navigation names, shortcuts, approvals, device trust, ...) is a
//! set of tables here, created by numbered migrations. The version is SQLite's own
//! `user_version`; a database newer than this build is refused, never downgraded.
use rusqlite::{Connection, TransactionBehavior};
use std::path::{Path, PathBuf};

/// One entry per schema version, oldest first. Never edit a shipped entry: add a new one.
const MIGRATIONS: &[&str] = &[
    // 1: credentials (encrypted by the credential crate, which also creates this idempotently)
    "CREATE TABLE IF NOT EXISTS secrets (
         profile TEXT NOT NULL,
         service TEXT NOT NULL,
         account TEXT NOT NULL,
         nonce BLOB NOT NULL,
         ciphertext BLOB NOT NULL,
         updated_at INTEGER NOT NULL,
         PRIMARY KEY (profile, service, account)
     ) WITHOUT ROWID;",
    // 2: settings. One document of sections and keys for this device, and the id-keyed
    // preference state the Settings screens edit (with a revision for safe concurrent edits).
    "CREATE TABLE settings_document (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         document TEXT NOT NULL
     );
     CREATE TABLE settings_state (
         scope TEXT PRIMARY KEY,
         revision INTEGER NOT NULL,
         document TEXT NOT NULL
     ) WITHOUT ROWID;",
    // 3: which earlier-layout files have already been imported (so a deleted row never
    // brings its old file back), and the names the person gave to windows, tabs and groups
    "CREATE TABLE legacy_imports (name TEXT PRIMARY KEY) WITHOUT ROWID;
     CREATE TABLE navigation_names (
         account TEXT NOT NULL,
         key TEXT NOT NULL,
         name TEXT NOT NULL,
         PRIMARY KEY (account, key)
     ) WITHOUT ROWID;",
    // 4: keyboard shortcut overrides (NULL = platform default, '' = unbound)
    "CREATE TABLE shortcut_overrides (
         command_id TEXT PRIMARY KEY,
         primary_binding TEXT,
         alternate_binding TEXT
     ) WITHOUT ROWID;",
    // 5: the account this device last signed in with
    "CREATE TABLE session (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         document TEXT NOT NULL
     );",
    // 6: what this device trusts for each signed-in account (vault root, device list, policy)
    "CREATE TABLE device_trust (
         key TEXT PRIMARY KEY,
         document TEXT NOT NULL
     ) WITHOUT ROWID;",
    // 7: Kura installs this device approved, by the hash of their token
    "CREATE TABLE kura_approvals (hash TEXT PRIMARY KEY) WITHOUT ROWID;",
    // 8: website camera and microphone choices (permissions is the engine's JSON)
    "CREATE TABLE site_permissions (
         profile TEXT NOT NULL,
         origin TEXT NOT NULL,
         permissions TEXT NOT NULL,
         PRIMARY KEY (profile, origin)
     ) WITHOUT ROWID;",
    // 9: folders this device shared with agents (a write folder is a project), and this
    // device's own agent settings (its device id)
    "CREATE TABLE local_agent_settings (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
     );
     CREATE TABLE local_agent_scopes (
         id TEXT PRIMARY KEY,
         device_id TEXT NOT NULL,
         display_name TEXT NOT NULL,
         local_path TEXT NOT NULL UNIQUE,
         created_at TEXT NOT NULL,
         access TEXT NOT NULL DEFAULT 'read',
         allow_installs INTEGER NOT NULL DEFAULT 0,
         allow_push INTEGER NOT NULL DEFAULT 0,
         allow_push_default INTEGER NOT NULL DEFAULT 0
     );",
    // 10: the browser's durable library: the downloads list and browsing history (visits
    // carry their profile; `origin` is the device that browsed, '' = this one; `changed`
    // marks a visit not yet in its synced batch; `history_dirty` holds hours whose batch
    // must be rewritten after a deletion)
    "CREATE TABLE downloads (
         id TEXT PRIMARY KEY,
         url TEXT NOT NULL,
         path TEXT NOT NULL,
         state TEXT NOT NULL,
         error TEXT,
         received INTEGER NOT NULL DEFAULT 0,
         total INTEGER NOT NULL DEFAULT -1,
         started_at INTEGER NOT NULL,
         finished_at INTEGER
     );
     CREATE INDEX downloads_started ON downloads(started_at);
     CREATE TABLE visits (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         profile_id TEXT NOT NULL,
         url TEXT NOT NULL,
         title TEXT NOT NULL DEFAULT '',
         visited_at INTEGER NOT NULL,
         typed INTEGER NOT NULL DEFAULT 0,
         origin TEXT NOT NULL DEFAULT '',
         changed INTEGER NOT NULL DEFAULT 1
     );
     CREATE INDEX visits_profile_time ON visits(profile_id, visited_at);
     CREATE INDEX visits_profile_url ON visits(profile_id, url);
     CREATE INDEX visits_sync ON visits(profile_id, origin, visited_at);
     CREATE TABLE history_dirty (
         origin TEXT NOT NULL,
         hour INTEGER NOT NULL,
         PRIMARY KEY (origin, hour)
     );",
    // 11: extension storage values waiting to sync (sealed with a device key, one per
    // installation generation) and installations removed here whose remote values still
    // need clearing
    "CREATE TABLE extension_journal (
         account TEXT NOT NULL,
         installation TEXT NOT NULL,
         sealed BLOB NOT NULL,
         PRIMARY KEY (account, installation)
     ) WITHOUT ROWID;
     CREATE TABLE extension_removals (
         account TEXT NOT NULL,
         generation TEXT NOT NULL,
         installation TEXT NOT NULL,
         PRIMARY KEY (account, generation)
     ) WITHOUT ROWID;",
    // 12: the file list's recent and starred files, tags and last opened path (one document)
    "CREATE TABLE explorer_library (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         document TEXT NOT NULL
     );",
    // 13: the Misty home's layout version (what the launch-time upgrade has applied)
    "CREATE TABLE IF NOT EXISTS layout (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         version INTEGER NOT NULL
     );",
    // 14: the file organizer's write-ahead journal: folder grants, and plans with a receipt
    // per move (written before each effect, so a crash can finish or undo a plan)
    "CREATE TABLE IF NOT EXISTS agent_file_grants (
         id TEXT PRIMARY KEY,
         document TEXT NOT NULL
     );
     CREATE TABLE IF NOT EXISTS agent_file_manifests (
         id TEXT PRIMARY KEY,
         document TEXT NOT NULL,
         saved_at INTEGER NOT NULL
     );",
    // 15: projects' old access switches become remembered approvals on the server; this
    // marks a project whose switches were carried over (the switches stay for reference)
    "ALTER TABLE local_agent_scopes ADD COLUMN grants_migrated INTEGER NOT NULL DEFAULT 0;",
    // 16: agent chats kept on this device (conversations with their messages, their
    // folders, and import markers), one JSON document per row
    "CREATE TABLE agent_chats (
         account TEXT NOT NULL,
         kind TEXT NOT NULL,
         id TEXT NOT NULL,
         document TEXT NOT NULL,
         updated_at INTEGER NOT NULL,
         PRIMARY KEY (account, kind, id)
     ) WITHOUT ROWID;",
];

#[derive(Debug, Clone)]
pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn at(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Opens the database, creating it and applying any missing migrations.
    pub fn connect(&self) -> rusqlite::Result<Connection> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
                    Some(format!("Could not create the data folder: {error}")),
                )
            })?;
        }
        // Switching a new file to WAL is not covered by the busy timeout, so two first
        // opens at once can see "locked": try again briefly.
        let mut attempt = 0;
        let connection = loop {
            match self.open_once() {
                Ok(connection) => break connection,
                Err(error) if attempt < 40 && is_busy(&error) => {
                    attempt += 1;
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                Err(error) => return Err(error),
            }
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(connection)
    }

    /// Runs `import` once per `name` in this database (and records it), so an earlier
    /// layout's file is imported a single time and never overwrites later edits.
    pub fn import_once<E: From<rusqlite::Error>>(
        &self,
        name: &str,
        import: impl FnOnce(&Connection) -> Result<(), E>,
    ) -> Result<(), E> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let done: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM legacy_imports WHERE name = ?1)",
            [name],
            |row| row.get(0),
        )?;
        if done {
            return Ok(());
        }
        import(&transaction)?;
        transaction.execute("INSERT INTO legacy_imports (name) VALUES (?1)", [name])?;
        transaction.commit()?;
        Ok(())
    }

    fn open_once(&self) -> rusqlite::Result<Connection> {
        let mut connection = Connection::open(&self.path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
             PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;",
        )?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

fn is_busy(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(failure, _)
            if matches!(failure.code, rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)
    )
}

fn version(connection: &Connection) -> rusqlite::Result<i64> {
    connection.query_row("PRAGMA user_version", [], |row| row.get(0))
}

/// Applies every migration to `connection` (the same path `Store::connect` takes).
pub(crate) fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
    if version(connection)? as usize >= MIGRATIONS.len() {
        return refuse_newer(connection);
    }
    // Two launches (or a launch and the CLI) can race here: take the write lock first and
    // read the version inside it.
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let current = version(&transaction)? as usize;
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        transaction.execute_batch(sql)?;
        transaction.execute_batch(&format!("PRAGMA user_version = {}", index + 1))?;
    }
    transaction.commit()
}

fn refuse_newer(connection: &Connection) -> rusqlite::Result<()> {
    if version(connection)? as usize > MIGRATIONS.len() {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_SCHEMA),
            Some("This data was written by a newer Misty. Update Misty to open it.".into()),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> (tempfile::TempDir, Store) {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("nested/misty.db"));
        (directory, store)
    }

    #[test]
    fn creates_the_database_and_applies_every_migration_once() {
        let (_directory, store) = temp_store();
        let connection = store.connect().unwrap();
        assert_eq!(version(&connection).unwrap() as usize, MIGRATIONS.len());
        drop(connection);
        let again = store.connect().unwrap();
        assert_eq!(version(&again).unwrap() as usize, MIGRATIONS.len());
    }

    #[test]
    fn refuses_a_database_from_a_newer_version() {
        let (_directory, store) = temp_store();
        let connection = store.connect().unwrap();
        connection
            .execute_batch(&format!("PRAGMA user_version = {}", MIGRATIONS.len() + 1))
            .unwrap();
        drop(connection);
        assert!(store.connect().is_err());
    }

    #[test]
    fn concurrent_first_opens_do_not_conflict() {
        let (_directory, store) = temp_store();
        let handles: Vec<_> = (0..4)
            .map(|_| {
                let store = store.clone();
                std::thread::spawn(move || store.connect().map(|_| ()))
            })
            .collect();
        for handle in handles {
            handle.join().unwrap().unwrap();
        }
    }
}
