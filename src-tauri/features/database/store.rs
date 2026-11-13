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
    // 6: what this device trusts for each signed-in account (device list, policy)
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
    // from the server can stand in for the person's answer.
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
    // `sent`, `changed`, `backfill` and `memory_deleted` were for syncing it; migration 30 drops them.
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
    // each run has read, which decides what it may send out (agents/run_control/run_taint.rs).
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
    // 27: the connections a person made so an agent Misty doesn't start (Cursor, the Claude app) could
    // use one of their Spaces. The feature is gone; migration 29 drops the table.
    "CREATE TABLE space_connections (
         id TEXT PRIMARY KEY,
         account TEXT NOT NULL,
         space TEXT NOT NULL,
         name TEXT NOT NULL,
         token_hash TEXT NOT NULL UNIQUE,
         created_at INTEGER NOT NULL
     ) WITHOUT ROWID;",
    // 28: the Git worktrees multi-run made, one per agent given the same task, each with the chat
    // its turn runs in. A row is what lets an engine work in that worktree (engines/multirun.rs).
    "CREATE TABLE multirun_worktrees (
         account TEXT NOT NULL,
         multirun TEXT NOT NULL,
         lane INTEGER NOT NULL,
         space TEXT NOT NULL,
         folder TEXT NOT NULL,
         path TEXT NOT NULL UNIQUE,
         branch TEXT NOT NULL,
         base TEXT NOT NULL,
         agent TEXT NOT NULL,
         conversation TEXT NOT NULL,
         task TEXT NOT NULL,
         kept INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL,
         PRIMARY KEY (account, multirun, lane)
     ) WITHOUT ROWID;",
    // 29: outside agents can no longer connect to a Space, so the connections and their token
    // hashes go, and no token handed out before can ever be honored again.
    "DROP TABLE IF EXISTS space_connections;",
    // 30: memory and browsing history stay on this computer, so what tracked their syncing goes:
    // memory's sent and changed marks, its deletions waiting to go out, the mark on copies that
    // came from elsewhere, and the history hours waiting to be sent again.
    "DROP INDEX IF EXISTS memory_events_changed;
     DROP INDEX IF EXISTS memory_facts_changed;
     ALTER TABLE memory_events DROP COLUMN sent;
     ALTER TABLE memory_events DROP COLUMN changed;
     ALTER TABLE memory_facts DROP COLUMN sent;
     ALTER TABLE memory_facts DROP COLUMN changed;
     ALTER TABLE memory_summaries DROP COLUMN sent;
     ALTER TABLE memory_summaries DROP COLUMN changed;
     ALTER TABLE memory_chunks DROP COLUMN backfill;
     DROP TABLE IF EXISTS memory_deleted;
     DROP TABLE IF EXISTS history_dirty;",
    // 31: one row per run, whatever engine ran it, for a Space's timeline on this computer: the mode
    // it started in, how it ended, how many tools it used and which files it wrote
    // (agents/run_control/run_ledger.rs). Never synced.
    "CREATE TABLE agent_run_ledger (
         run_id TEXT PRIMARY KEY,
         account TEXT NOT NULL,
         conversation_id TEXT NOT NULL,
         engine TEXT NOT NULL,
         mode TEXT NOT NULL,
         started_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         state TEXT NOT NULL,
         tools INTEGER NOT NULL DEFAULT 0,
         files TEXT NOT NULL DEFAULT '[]'
     ) WITHOUT ROWID;
     CREATE INDEX agent_run_ledger_chat ON agent_run_ledger(account, conversation_id, started_at);",
    // 32: each run's steps on this computer, for the person's own activity view
    // (agents/run_control/run_steps.rs): the tool, the file or page it worked on and how it ended,
    // never its arguments or result. A sub-agent's run files its steps under the run that started
    // it. Never synced.
    "CREATE TABLE agent_run_steps (
         run_id TEXT NOT NULL,
         seq INTEGER NOT NULL,
         account TEXT NOT NULL,
         call_id TEXT NOT NULL,
         at INTEGER NOT NULL,
         tool TEXT NOT NULL,
         target TEXT NOT NULL DEFAULT '',
         title TEXT NOT NULL DEFAULT '',
         state TEXT NOT NULL,
         duration_ms INTEGER NOT NULL DEFAULT 0,
         nested INTEGER NOT NULL DEFAULT 0,
         picture TEXT NOT NULL DEFAULT '',
         PRIMARY KEY (run_id, seq)
     ) WITHOUT ROWID;
     CREATE INDEX agent_run_steps_call ON agent_run_steps(run_id, call_id);
     CREATE INDEX agent_run_steps_account ON agent_run_steps(account, at);
     CREATE TABLE agent_run_parents (
         run_id TEXT PRIMARY KEY,
         parent_run_id TEXT NOT NULL,
         at INTEGER NOT NULL
     ) WITHOUT ROWID;",
    // 33: memory becomes Engram's sessions, observations, relations and prompts beside MemPalace's
    // drawers, closets and hallways, on this computer only. Facts become
    // observations, moments become drawers in rooms by kind, recaps and summaries become sessions.
    // Old vectors go: records are embedded again as the Embedding role is used, tagged by model.
    "DROP TABLE memory_vectors;
     DROP TABLE memory_chunks;
     CREATE TABLE memory_sessions (
         account TEXT NOT NULL,
         id TEXT NOT NULL,
         space_id TEXT NOT NULL,
         agent_id TEXT NOT NULL DEFAULT '',
         kind TEXT NOT NULL DEFAULT 'chat',
         title TEXT NOT NULL DEFAULT '',
         directory TEXT NOT NULL DEFAULT '',
         started_at INTEGER NOT NULL,
         ended_at INTEGER,
         summary TEXT,
         outline TEXT,
         PRIMARY KEY (account, id)
     ) WITHOUT ROWID;
     CREATE INDEX memory_sessions_space ON memory_sessions(account, space_id, started_at);
     CREATE TABLE memory_session_finalizations (
         account TEXT NOT NULL,
         session_id TEXT NOT NULL,
         summary_id INTEGER NOT NULL,
         summary_sync_id TEXT NOT NULL,
         PRIMARY KEY (account, session_id)
     ) WITHOUT ROWID;
     CREATE TABLE memory_observations (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         sync_id TEXT NOT NULL UNIQUE,
         account TEXT NOT NULL,
         session_id TEXT NOT NULL,
         space_id TEXT NOT NULL,
         agent_id TEXT NOT NULL DEFAULT '',
         wing TEXT NOT NULL,
         room TEXT NOT NULL,
         type TEXT NOT NULL,
         title TEXT NOT NULL,
         content TEXT NOT NULL,
         tool_name TEXT,
         scope TEXT NOT NULL DEFAULT 'project',
         topic_key TEXT,
         normalized_hash TEXT NOT NULL,
         revision_count INTEGER NOT NULL DEFAULT 1,
         duplicate_count INTEGER NOT NULL DEFAULT 1,
         last_seen_at INTEGER,
         last_used_at INTEGER,
         pinned INTEGER NOT NULL DEFAULT 0,
         origin TEXT NOT NULL DEFAULT 'agent',
         trust TEXT NOT NULL DEFAULT 'trusted',
         reason TEXT NOT NULL DEFAULT '',
         source_conversation_id TEXT NOT NULL DEFAULT '',
         source_run_id TEXT NOT NULL DEFAULT '',
         review_after INTEGER,
         expires_at INTEGER,
         superseded_by_sync_id TEXT,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         deleted_at INTEGER
     );
     CREATE INDEX memory_observations_scope ON memory_observations(account, space_id, agent_id, updated_at);
     CREATE INDEX memory_observations_topic ON memory_observations(account, topic_key) WHERE topic_key IS NOT NULL;
     CREATE INDEX memory_observations_hash ON memory_observations(account, normalized_hash);
     CREATE INDEX memory_observations_session ON memory_observations(account, session_id, created_at);
     CREATE INDEX memory_observations_review ON memory_observations(account, review_after)
         WHERE review_after IS NOT NULL AND deleted_at IS NULL;
     CREATE VIRTUAL TABLE memory_observations_fts USING fts5(
         title, content, tool_name, type, wing, topic_key,
         tokenize = 'trigram remove_diacritics 1',
         content = 'memory_observations', content_rowid = 'id'
     );
     CREATE TRIGGER memory_observations_ai AFTER INSERT ON memory_observations BEGIN
         INSERT INTO memory_observations_fts (rowid, title, content, tool_name, type, wing, topic_key)
         VALUES (new.id, new.title, new.content, new.tool_name, new.type, new.wing, new.topic_key);
     END;
     CREATE TRIGGER memory_observations_ad AFTER DELETE ON memory_observations BEGIN
         INSERT INTO memory_observations_fts (memory_observations_fts, rowid, title, content, tool_name, type, wing, topic_key)
         VALUES ('delete', old.id, old.title, old.content, old.tool_name, old.type, old.wing, old.topic_key);
     END;
     CREATE TRIGGER memory_observations_au AFTER UPDATE OF title, content, tool_name, type, wing, topic_key
         ON memory_observations BEGIN
         INSERT INTO memory_observations_fts (memory_observations_fts, rowid, title, content, tool_name, type, wing, topic_key)
         VALUES ('delete', old.id, old.title, old.content, old.tool_name, old.type, old.wing, old.topic_key);
         INSERT INTO memory_observations_fts (rowid, title, content, tool_name, type, wing, topic_key)
         VALUES (new.id, new.title, new.content, new.tool_name, new.type, new.wing, new.topic_key);
     END;
     CREATE TABLE memory_observation_versions (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         observation_id INTEGER NOT NULL REFERENCES memory_observations(id) ON DELETE CASCADE,
         title TEXT,
         content TEXT NOT NULL,
         version INTEGER NOT NULL,
         created_at INTEGER NOT NULL,
         UNIQUE (observation_id, version)
     );
     CREATE TABLE memory_relations (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         sync_id TEXT NOT NULL UNIQUE,
         account TEXT NOT NULL,
         source_id TEXT,
         target_id TEXT,
         relation TEXT NOT NULL DEFAULT 'pending',
         reason TEXT,
         evidence TEXT,
         confidence REAL,
         judgment_status TEXT NOT NULL DEFAULT 'pending',
         marked_by_actor TEXT,
         marked_by_kind TEXT,
         marked_by_model TEXT,
         session_id TEXT,
         superseded_at INTEGER,
         superseded_by_relation_id INTEGER REFERENCES memory_relations(id) ON DELETE SET NULL,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
     );
     CREATE INDEX memory_relations_source ON memory_relations(account, source_id, judgment_status);
     CREATE INDEX memory_relations_target ON memory_relations(account, target_id, judgment_status);
     CREATE TABLE memory_prompts (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         sync_id TEXT NOT NULL UNIQUE,
         account TEXT NOT NULL,
         session_id TEXT NOT NULL,
         space_id TEXT NOT NULL,
         agent_id TEXT NOT NULL DEFAULT '',
         content TEXT NOT NULL,
         created_at INTEGER NOT NULL
     );
     CREATE INDEX memory_prompts_space ON memory_prompts(account, space_id, created_at);
     CREATE VIRTUAL TABLE memory_prompts_fts USING fts5(
         content, tokenize = 'trigram remove_diacritics 1',
         content = 'memory_prompts', content_rowid = 'id'
     );
     CREATE TRIGGER memory_prompts_ai AFTER INSERT ON memory_prompts BEGIN
         INSERT INTO memory_prompts_fts (rowid, content) VALUES (new.id, new.content);
     END;
     CREATE TRIGGER memory_prompts_ad AFTER DELETE ON memory_prompts BEGIN
         INSERT INTO memory_prompts_fts (memory_prompts_fts, rowid, content) VALUES ('delete', old.id, old.content);
     END;
     CREATE TABLE memory_drawers (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         drawer_id TEXT NOT NULL UNIQUE,
         account TEXT NOT NULL,
         space_id TEXT NOT NULL,
         wing TEXT NOT NULL,
         room TEXT NOT NULL,
         hall TEXT NOT NULL DEFAULT 'general',
         source_kind TEXT NOT NULL,
         source_file TEXT NOT NULL,
         chunk_index INTEGER NOT NULL DEFAULT 0,
         title TEXT NOT NULL DEFAULT '',
         content TEXT NOT NULL,
         entities TEXT NOT NULL DEFAULT '',
         added_by TEXT NOT NULL DEFAULT '',
         url TEXT NOT NULL DEFAULT '',
         site TEXT NOT NULL DEFAULT '',
         app TEXT NOT NULL DEFAULT '',
         window_title TEXT NOT NULL DEFAULT '',
         capture_session TEXT NOT NULL DEFAULT '',
         ref_id TEXT NOT NULL DEFAULT '',
         content_hash TEXT NOT NULL DEFAULT '',
         filed_at INTEGER NOT NULL,
         authored_at INTEGER
     );
     CREATE INDEX memory_drawers_place ON memory_drawers(account, space_id, wing, room, filed_at);
     CREATE INDEX memory_drawers_source ON memory_drawers(account, source_file, chunk_index);
     CREATE VIRTUAL TABLE memory_drawers_fts USING fts5(
         title, content, entities, room,
         tokenize = 'trigram remove_diacritics 1',
         content = 'memory_drawers', content_rowid = 'id'
     );
     CREATE TRIGGER memory_drawers_ai AFTER INSERT ON memory_drawers BEGIN
         INSERT INTO memory_drawers_fts (rowid, title, content, entities, room)
         VALUES (new.id, new.title, new.content, new.entities, new.room);
     END;
     CREATE TRIGGER memory_drawers_ad AFTER DELETE ON memory_drawers BEGIN
         INSERT INTO memory_drawers_fts (memory_drawers_fts, rowid, title, content, entities, room)
         VALUES ('delete', old.id, old.title, old.content, old.entities, old.room);
     END;
     CREATE TABLE memory_closets (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         closet_id TEXT NOT NULL UNIQUE,
         account TEXT NOT NULL,
         space_id TEXT NOT NULL,
         wing TEXT NOT NULL,
         room TEXT NOT NULL,
         source_file TEXT NOT NULL,
         text TEXT NOT NULL
     );
     CREATE INDEX memory_closets_source ON memory_closets(account, space_id, source_file);
     CREATE VIRTUAL TABLE memory_closets_fts USING fts5(
         text, tokenize = 'unicode61 remove_diacritics 2',
         content = 'memory_closets', content_rowid = 'id'
     );
     CREATE TRIGGER memory_closets_ai AFTER INSERT ON memory_closets BEGIN
         INSERT INTO memory_closets_fts (rowid, text) VALUES (new.id, new.text);
     END;
     CREATE TRIGGER memory_closets_ad AFTER DELETE ON memory_closets BEGIN
         INSERT INTO memory_closets_fts (memory_closets_fts, rowid, text) VALUES ('delete', old.id, old.text);
     END;
     CREATE TABLE memory_hallways (
         account TEXT NOT NULL,
         space_id TEXT NOT NULL,
         wing TEXT NOT NULL,
         entity_a TEXT NOT NULL,
         entity_b TEXT NOT NULL,
         name_a TEXT NOT NULL,
         name_b TEXT NOT NULL,
         count INTEGER NOT NULL DEFAULT 1,
         rooms TEXT NOT NULL DEFAULT '[]',
         strength REAL NOT NULL DEFAULT 1.0,
         stability REAL NOT NULL DEFAULT 1.0,
         last_activated INTEGER NOT NULL,
         access_count INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL,
         PRIMARY KEY (account, space_id, wing, entity_a, entity_b)
     ) WITHOUT ROWID;
     CREATE INDEX memory_hallways_b ON memory_hallways(account, space_id, entity_b);
     CREATE TABLE memory_vectors (
         kind TEXT NOT NULL,
         record_id INTEGER NOT NULL,
         account TEXT NOT NULL,
         space_id TEXT NOT NULL,
         wing TEXT NOT NULL,
         everywhere INTEGER NOT NULL DEFAULT 0,
         model TEXT NOT NULL,
         dimensions INTEGER NOT NULL,
         text_hash TEXT NOT NULL,
         embedding BLOB NOT NULL,
         PRIMARY KEY (kind, record_id)
     ) WITHOUT ROWID;
     CREATE INDEX memory_vectors_scope ON memory_vectors(account, model, dimensions, space_id);
     CREATE TABLE memory_embed_leases (
         kind TEXT NOT NULL,
         record_id INTEGER NOT NULL,
         attempts INTEGER NOT NULL DEFAULT 0,
         lease_until INTEGER,
         due_at INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (kind, record_id)
     ) WITHOUT ROWID;
     INSERT INTO memory_sessions (account, id, space_id, agent_id, kind, title, started_at)
         SELECT account, 'manual-' || space_id || '-' || CASE WHEN agent_id = '' THEN 'misty' ELSE agent_id END,
             space_id, agent_id, 'manual', 'Saved memories', min(created_at)
         FROM memory_facts GROUP BY account, space_id, agent_id;
     INSERT INTO memory_observations (sync_id, account, session_id, space_id, agent_id, wing, room, type,
             title, content, scope, normalized_hash, last_seen_at, last_used_at, origin, reason,
             source_conversation_id, source_run_id, review_after, created_at, updated_at)
         SELECT 'obs-' || lower(hex(randomblob(8))), account,
             'manual-' || space_id || '-' || CASE WHEN agent_id = '' THEN 'misty' ELSE agent_id END,
             space_id, agent_id, CASE WHEN agent_id = '' THEN 'space' ELSE 'agent:' || agent_id END,
             kind, kind, CASE WHEN length(content) > 80 THEN substr(content, 1, 79) || '…' ELSE content END,
             content, CASE WHEN space_id = '' THEN 'personal' ELSE 'project' END, memory_key, updated_at,
             last_used_at, 'migrated', reason, source_conversation_id, source_invocation_id,
             CASE WHEN kind = 'preference' THEN updated_at + 7776000000 END, created_at, updated_at
         FROM memory_facts ORDER BY created_at;
     INSERT OR IGNORE INTO memory_drawers (drawer_id, account, space_id, wing, room, hall, source_kind,
             source_file, chunk_index, title, content, url, site, app, window_title, capture_session,
             ref_id, content_hash, filed_at, authored_at, added_by)
         SELECT 'drawer_space_' || CASE e.kind WHEN 'voice' THEN 'dictation' WHEN 'recording' THEN 'recordings'
                 WHEN 'note' THEN 'notes' WHEN 'screen' THEN 'captures' ELSE 'pages' END
                 || '_' || lower(hex(randomblob(8))),
             e.account, e.space_id, 'space',
             CASE e.kind WHEN 'voice' THEN 'dictation' WHEN 'recording' THEN 'recordings'
                 WHEN 'note' THEN 'notes' WHEN 'screen' THEN 'captures' ELSE 'pages' END,
             'general', e.kind, 'moment:' || e.id, 0, e.title,
             CASE WHEN trim(e.body) = '' THEN e.title ELSE e.body END,
             e.url, e.site, e.app, e.window_title, e.session_id, e.ref_id, '', e.updated_at, e.occurred_at,
             'person'
         FROM memory_events e
         WHERE e.same_as IS NULL AND trim(e.title || e.body) <> '';
     INSERT OR IGNORE INTO memory_sessions (account, id, space_id, kind, title, started_at, ended_at, summary, outline)
         SELECT account,
             CASE WHEN surface_id LIKE 'recap-%' THEN 'recap:' || space_id || ':' || substr(surface_id, 7)
                  WHEN surface_id LIKE 'manual-%' THEN 'summary-' || substr(surface_id, 8)
                  ELSE 'summary-' || surface_id END,
             space_id,
             CASE WHEN surface_id LIKE 'recap-%' THEN 'recap' ELSE 'manual' END,
             title, updated_at, updated_at, text, outline
         FROM memory_summaries;
     DROP TABLE memory_events;
     DROP TABLE memory_facts;
     DROP TABLE memory_summaries;",
    // 34: the virtual office is called the studio: its rooms and looks move to the new kind.
    "UPDATE agent_chats SET kind = 'studio' WHERE kind = 'office';",
    // 35: Misty keeps no memory of its own, and no workflows, schedules or skills: engines have
    // them. Their tables and saved documents go.
    "DROP TABLE IF EXISTS memory_observations_fts;
     DROP TABLE IF EXISTS memory_prompts_fts;
     DROP TABLE IF EXISTS memory_drawers_fts;
     DROP TABLE IF EXISTS memory_closets_fts;
     DROP TABLE IF EXISTS memory_observation_versions;
     DROP TABLE IF EXISTS memory_relations;
     DROP TABLE IF EXISTS memory_observations;
     DROP TABLE IF EXISTS memory_session_finalizations;
     DROP TABLE IF EXISTS memory_sessions;
     DROP TABLE IF EXISTS memory_prompts;
     DROP TABLE IF EXISTS memory_drawers;
     DROP TABLE IF EXISTS memory_closets;
     DROP TABLE IF EXISTS memory_hallways;
     DROP TABLE IF EXISTS memory_embed_leases;
     DELETE FROM agent_chats
         WHERE kind IN ('workflow_method', 'workflow_schedule', 'workflow_replay', 'workflow_vector');",
    // 36: what nothing reads any more: extensions' install journal, removals and approvals, memory's
    // vectors, websites' camera, microphone and location choices (websites never get them now),
    // and the downloads list and browsing history a person's own tabs kept.
    "DROP TABLE IF EXISTS extension_journal;
     DROP TABLE IF EXISTS extension_removals;
     DROP TABLE IF EXISTS extension_approvals;
     DROP TABLE IF EXISTS memory_vectors;
     DROP TABLE IF EXISTS site_permissions;
     DROP TABLE IF EXISTS downloads;
     DROP TABLE IF EXISTS visits;",
    // 37: each agent's one folder on this computer, where every chat with it works on an outside
    // engine (engines/store.rs). Never synced.
    "CREATE TABLE agent_folders (
         account TEXT NOT NULL,
         agent_id TEXT NOT NULL,
         path TEXT NOT NULL,
         updated_at INTEGER NOT NULL,
         PRIMARY KEY (account, agent_id)
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
