CREATE TABLE IF NOT EXISTS files (
    file_path TEXT PRIMARY KEY,
    mtime INTEGER NOT NULL,
    size INTEGER NOT NULL,
    is_dir INTEGER NOT NULL DEFAULT 0,
    hash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    token_valid_after TEXT
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
    ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash
    ON refresh_tokens(token_hash);

CREATE TABLE IF NOT EXISTS revoked_access_tokens (
    token_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_access_tokens_user_id
    ON revoked_access_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_revoked_access_tokens_expires_at
    ON revoked_access_tokens(expires_at);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    peer_hostname TEXT NOT NULL UNIQUE,
    peer_type TEXT NOT NULL,
    peer_address TEXT NOT NULL,
    device_name TEXT NOT NULL DEFAULT '',
    mount_path TEXT NOT NULL DEFAULT '',
    workspace_id TEXT,
    last_seen TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_workspace_id
    ON devices(workspace_id);

CREATE TABLE IF NOT EXISTS sync_roots (
    id TEXT PRIMARY KEY,
    remote_name TEXT NOT NULL UNIQUE,
    remote_type TEXT NOT NULL DEFAULT '',
    provider_folder TEXT NOT NULL DEFAULT '',
    folder_name TEXT NOT NULL DEFAULT '',
    mount_root TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    dirty_bit INTEGER NOT NULL DEFAULT 0,
    last_refetch_at TEXT,
    last_poll_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_entries (
    id TEXT PRIMARY KEY,
    root_id TEXT NOT NULL REFERENCES sync_roots(id) ON DELETE CASCADE,
    rel_path TEXT NOT NULL,
    parent_rel_path TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    is_dir INTEGER NOT NULL DEFAULT 0,
    local_exists INTEGER NOT NULL DEFAULT 0,
    remote_exists INTEGER NOT NULL DEFAULT 0,
    is_dirty INTEGER NOT NULL DEFAULT 0,
    sync_direction TEXT NOT NULL DEFAULT 'none',
    local_mtime TEXT,
    local_size INTEGER,
    remote_mtime TEXT,
    remote_size INTEGER,
    remote_revision TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    state_code TEXT NOT NULL DEFAULT 'REM',
    last_seen_local_at TEXT,
    last_seen_remote_at TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(root_id, rel_path)
);

CREATE INDEX IF NOT EXISTS idx_sync_entries_root_parent_name
    ON sync_entries(root_id, parent_rel_path, name);
CREATE INDEX IF NOT EXISTS idx_sync_entries_root_dirty
    ON sync_entries(root_id, is_dirty);
CREATE INDEX IF NOT EXISTS idx_sync_entries_root_updated
    ON sync_entries(root_id, updated_at);

CREATE TABLE IF NOT EXISTS file_metadata (
    remote_name TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    parent_rel_path TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    is_dir INTEGER NOT NULL DEFAULT 0,
    local_exists INTEGER NOT NULL DEFAULT 0,
    local_mtime TEXT,
    local_size INTEGER,
    remote_exists INTEGER NOT NULL DEFAULT 0,
    remote_mtime TEXT,
    remote_size INTEGER,
    remote_revision TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    local_dirty INTEGER NOT NULL DEFAULT 0,
    last_local_event_at TEXT,
    last_local_seen_at TEXT,
    last_remote_seen_at TEXT,
    last_compared_at TEXT,
    last_synced_at TEXT,
    last_error TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (remote_name, rel_path)
);

CREATE INDEX IF NOT EXISTS idx_file_metadata_remote_parent_name
    ON file_metadata(remote_name, parent_rel_path, name);
CREATE INDEX IF NOT EXISTS idx_file_metadata_remote_dirty
    ON file_metadata(remote_name, local_dirty);
CREATE INDEX IF NOT EXISTS idx_file_metadata_remote_updated
    ON file_metadata(remote_name, updated_at);

CREATE TABLE IF NOT EXISTS watched_dirs (
    remote_name TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (remote_name, rel_path)
);

CREATE INDEX IF NOT EXISTS idx_watched_dirs_remote_name
    ON watched_dirs(remote_name);

CREATE TABLE IF NOT EXISTS file_hash (
    remote_name TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    side TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    hash_value TEXT NOT NULL,
    observed_mtime TEXT NOT NULL,
    observed_size INTEGER,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (remote_name, rel_path, side, algorithm)
);

CREATE INDEX IF NOT EXISTS idx_file_hash_remote_path_side
    ON file_hash(remote_name, rel_path, side);
