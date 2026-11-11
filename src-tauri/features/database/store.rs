//! Misty's database: `~/.misty/data/misty.db`, the one place structured data lives.
//! Every store (settings, navigation names, shortcuts, approvals, device trust, ...) is a
//! set of tables here, created by numbered migrations. The version is SQLite's own
//! `user_version`; a database newer than this build is refused, never downgraded.
use file_access::fs;
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
    // 16: agent chats from when they lived on this device, one JSON document per row
    "CREATE TABLE agent_chats (
         account TEXT NOT NULL,
         kind TEXT NOT NULL,
         id TEXT NOT NULL,
         document TEXT NOT NULL,
         updated_at INTEGER NOT NULL,
         PRIMARY KEY (account, kind, id)
     ) WITHOUT ROWID;",
    // 17: hours to rewrite belong to one profile, and remember when they were marked so a
    // deletion made during an upload stays marked
    "DROP TABLE history_dirty;
     CREATE TABLE history_dirty (
         profile_id TEXT NOT NULL,
         origin TEXT NOT NULL,
         hour INTEGER NOT NULL,
         marked_at INTEGER NOT NULL,
         PRIMARY KEY (profile_id, origin, hour)
     );",
    // 18: what this database no longer keeps. Agent chats are on the server, the file
    // organizer and the Kura bridge are gone, and the file list's table was never used. The
    // device id and the marks that an account's first profile was seeded move into
    // `settings_state`, and projects' old switches are approvals now.
    "INSERT OR IGNORE INTO settings_state (scope, revision, document)
         SELECT 'device:id', 1, json_quote(value) FROM local_agent_settings WHERE key = 'device_id';
     INSERT OR IGNORE INTO settings_state (scope, revision, document)
         SELECT name, 1, 'true' FROM legacy_imports WHERE name LIKE 'profile-collections:%';
     DROP TABLE local_agent_settings;
     DROP TABLE agent_chats;
     DROP TABLE agent_file_grants;
     DROP TABLE agent_file_manifests;
     DROP TABLE explorer_library;
     DROP TABLE kura_approvals;
     DROP TABLE legacy_imports;
     ALTER TABLE local_agent_scopes DROP COLUMN allow_installs;
     ALTER TABLE local_agent_scopes DROP COLUMN allow_push;
     ALTER TABLE local_agent_scopes DROP COLUMN allow_push_default;
     ALTER TABLE local_agent_scopes DROP COLUMN grants_migrated;",
    // 19: folders are shared read-only. Ones shared with write access stop being shared; their files stay.
    "DELETE FROM local_agent_scopes WHERE access = 'write';
     ALTER TABLE local_agent_scopes DROP COLUMN access;",
    // 20: coding is gone, so its three device preferences go too: from the settings document,
    // from the saved values, and from the frozen first-run copy of the document kept in
    // `settings_state`. A document that isn't valid JSON is left as it is, so this can't fail.
    "UPDATE settings_document
     SET document = json_remove(document, '$.agent.coding_default_tool',
         '$.agent.coding_fallback_tool', '$.agent.coding_usage_cap')
     WHERE CASE WHEN json_valid(document) THEN coalesce(
         json_type(document, '$.agent.coding_default_tool'),
         json_type(document, '$.agent.coding_fallback_tool'),
         json_type(document, '$.agent.coding_usage_cap')) IS NOT NULL ELSE 0 END;
     UPDATE settings_state
     SET revision = revision + 1, document = json_remove(document,
         '$.values.\"agents.coding_default_tool\"', '$.values.\"agents.coding_fallback_tool\"',
         '$.values.\"agents.coding_usage_cap\"', '$.agent.coding_default_tool',
         '$.agent.coding_fallback_tool', '$.agent.coding_usage_cap')
     WHERE CASE WHEN json_valid(document) THEN coalesce(
         json_type(document, '$.values.\"agents.coding_default_tool\"'),
         json_type(document, '$.values.\"agents.coding_fallback_tool\"'),
         json_type(document, '$.values.\"agents.coding_usage_cap\"'),
         json_type(document, '$.agent.coding_default_tool'),
         json_type(document, '$.agent.coding_fallback_tool'),
         json_type(document, '$.agent.coding_usage_cap')) IS NOT NULL ELSE 0 END;",
    // 21: what the person approved for each extension on this computer. It never syncs: nothing
    // from the server can stand in for the person's answer (browser/extensions/approvals.rs).
    "CREATE TABLE extension_approvals (
         scope TEXT NOT NULL,
         extension TEXT NOT NULL,
         permissions TEXT NOT NULL,
         hosts TEXT NOT NULL,
         PRIMARY KEY (scope, extension)
     ) WITHOUT ROWID;",
    // 22: agent chats live on this computer again: one JSON
    // document per conversation, folder, lesson and course. The server keeps no transcript.
    "CREATE TABLE agent_chats (
         account TEXT NOT NULL,
         kind TEXT NOT NULL,
         id TEXT NOT NULL,
         document TEXT NOT NULL,
         updated_at INTEGER NOT NULL,
         PRIMARY KEY (account, kind, id)
     ) WITHOUT ROWID;",
    // 23: what each of an agent's tool calls did, so a run that restarts never repeats a write it
    // can't account for. A row with no outcome began and nobody saw it end.
    "CREATE TABLE agent_tool_journal (
         run_id TEXT NOT NULL,
         call_id TEXT NOT NULL,
         name TEXT NOT NULL,
         outcome TEXT,
         updated_at INTEGER NOT NULL,
         PRIMARY KEY (run_id, call_id)
     ) WITHOUT ROWID;",
    // 24: Memory on this computer (memory): moments, facts and summaries per account and Space,
    // what waits for a vector, and the vectors themselves, apart so a search reads nothing else.
    // `sent` says the vault's record store has a row, `changed` that it needs this version, and
    // `memory_deleted` holds deletions the vault hasn't heard of.
    "CREATE TABLE memory_events (
         account TEXT NOT NULL,
         id TEXT NOT NULL,
         space_id TEXT NOT NULL,
         kind TEXT NOT NULL,
         device_id TEXT NOT NULL DEFAULT '',
         url TEXT NOT NULL DEFAULT '',
         site TEXT NOT NULL DEFAULT '',
         title TEXT NOT NULL DEFAULT '',
         simhash TEXT NOT NULL DEFAULT '',
         same_as TEXT,
         ref_id TEXT NOT NULL DEFAULT '',
         dwell_ms INTEGER NOT NULL DEFAULT 0,
         occurred_at INTEGER NOT NULL,
         app TEXT NOT NULL DEFAULT '',
         window_title TEXT NOT NULL DEFAULT '',
         session_id TEXT NOT NULL DEFAULT '',
         indexed INTEGER NOT NULL DEFAULT 0,
         updated_at INTEGER NOT NULL,
         sent INTEGER NOT NULL DEFAULT 0,
         changed INTEGER NOT NULL DEFAULT 1,
         body TEXT NOT NULL DEFAULT '',
         PRIMARY KEY (account, id)
     );
     CREATE INDEX memory_events_time ON memory_events(account, space_id, occurred_at);
     CREATE INDEX memory_events_url ON memory_events(account, space_id, url, occurred_at)
         WHERE same_as IS NULL AND simhash <> '';
     CREATE INDEX memory_events_same_as ON memory_events(account, same_as) WHERE same_as IS NOT NULL;
     CREATE INDEX memory_events_changed ON memory_events(account) WHERE changed = 1;
     CREATE TABLE memory_facts (
         account TEXT NOT NULL,
         id TEXT NOT NULL,
         space_id TEXT NOT NULL,
         agent_id TEXT NOT NULL DEFAULT '',
         memory_key TEXT NOT NULL,
         kind TEXT NOT NULL,
         content TEXT NOT NULL,
         reason TEXT NOT NULL DEFAULT '',
         source_conversation_id TEXT NOT NULL DEFAULT '',
         source_invocation_id TEXT NOT NULL DEFAULT '',
         last_used_at INTEGER,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         sent INTEGER NOT NULL DEFAULT 0,
         changed INTEGER NOT NULL DEFAULT 1,
         PRIMARY KEY (account, id),
         UNIQUE (account, space_id, agent_id, memory_key)
     );
     CREATE INDEX memory_facts_changed ON memory_facts(account) WHERE changed = 1;
     CREATE TABLE memory_summaries (
         account TEXT NOT NULL,
         space_id TEXT NOT NULL,
         surface_id TEXT NOT NULL,
         title TEXT NOT NULL DEFAULT '',
         text TEXT NOT NULL,
         outline TEXT,
         updated_at INTEGER NOT NULL,
         sent INTEGER NOT NULL DEFAULT 0,
         changed INTEGER NOT NULL DEFAULT 1,
         PRIMARY KEY (account, space_id, surface_id)
     );
     CREATE TABLE memory_chunks (
         id INTEGER PRIMARY KEY,
         account TEXT NOT NULL,
         space_id TEXT NOT NULL,
         branch TEXT NOT NULL,
         record_id TEXT NOT NULL,
         content_hash TEXT NOT NULL,
         embedded INTEGER NOT NULL DEFAULT 0,
         attempts INTEGER NOT NULL DEFAULT 0,
         lease_until INTEGER,
         due_at INTEGER NOT NULL,
         backfill INTEGER NOT NULL DEFAULT 0,
         text TEXT NOT NULL,
         UNIQUE (account, space_id, branch, record_id)
     );
     CREATE INDEX memory_chunks_pending ON memory_chunks(account, due_at) WHERE embedded = 0;
     CREATE INDEX memory_chunks_same_text ON memory_chunks(account, space_id, content_hash)
         WHERE embedded = 1;
     CREATE TABLE memory_vectors (
         chunk_id INTEGER PRIMARY KEY REFERENCES memory_chunks(id) ON DELETE CASCADE,
         account TEXT NOT NULL,
         space_id TEXT NOT NULL,
         branch TEXT NOT NULL,
         model TEXT NOT NULL,
         embedding BLOB NOT NULL
     );
     CREATE INDEX memory_vectors_scope ON memory_vectors(account, space_id, model);
     CREATE TABLE memory_deleted (
         account TEXT NOT NULL,
         record_id TEXT NOT NULL,
         deleted_at INTEGER NOT NULL,
         PRIMARY KEY (account, record_id)
     ) WITHOUT ROWID;",
    // 25: whose run each journal row belongs to, so one account never reads another's receipts, and what
    // each run has read, which decides what it may send out (agent_runtime/run_taint.rs).
    "ALTER TABLE agent_tool_journal ADD COLUMN account TEXT NOT NULL DEFAULT '';
     CREATE TABLE agent_run_taint (
         run_id TEXT NOT NULL,
         kind TEXT NOT NULL,
         updated_at INTEGER NOT NULL,
         PRIMARY KEY (run_id, kind)
     ) WITHOUT ROWID;",
    // 26: the project folders the person linked to each Space on this computer, where outside agent
    // engines work, and each chat's session in its engine, to continue it (engines/store.rs).
    "CREATE TABLE space_folders (
         account TEXT NOT NULL,
         space TEXT NOT NULL,
         path TEXT NOT NULL,
         added_at INTEGER NOT NULL,
         PRIMARY KEY (account, space, path)
     ) WITHOUT ROWID;
     CREATE TABLE engine_sessions (
         account TEXT NOT NULL,
         conversation_id TEXT NOT NULL,
         engine TEXT NOT NULL,
         session_id TEXT NOT NULL,
         folder TEXT NOT NULL,
         updated_at INTEGER NOT NULL,
         PRIMARY KEY (account, conversation_id, engine)
     ) WITHOUT ROWID;",
    // 27: the connections a person made so an agent Misty doesn't start (Cursor, the Claude app) can
    // use one of their Spaces. Only the token's hash is kept (engines/connections.rs).
    "CREATE TABLE space_connections (
         id TEXT PRIMARY KEY,
         account TEXT NOT NULL,
         space TEXT NOT NULL,
         name TEXT NOT NULL,
         token_hash TEXT NOT NULL UNIQUE,
         created_at INTEGER NOT NULL
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

    /// The database of the Misty home at `home`.
    pub fn in_home(home: &Path) -> Self {
        Self::at(misty_credential_store::home_data_dir(home).join("misty.db"))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Opens the database, creating it and applying any missing migrations.
    pub fn connect(&self) -> rusqlite::Result<Connection> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
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
            let _ = fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600));
        }
        Ok(connection)
    }

    fn open_once(&self) -> rusqlite::Result<Connection> {
        let mut connection = fs::open_sqlite(&self.path)?;
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
pub fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
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
mod tests;
