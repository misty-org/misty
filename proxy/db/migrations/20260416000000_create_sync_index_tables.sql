-- +goose Up
-- +goose StatementBegin
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
    remote_revision TEXT,
    mime_type TEXT NOT NULL DEFAULT '',
    state_code TEXT NOT NULL DEFAULT 'REM',
    last_seen_local_at TEXT,
    last_seen_remote_at TEXT,
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
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_sync_entries_root_updated;
DROP INDEX IF EXISTS idx_sync_entries_root_dirty;
DROP INDEX IF EXISTS idx_sync_entries_root_parent_name;
DROP TABLE IF EXISTS sync_entries;
DROP TABLE IF EXISTS sync_roots;
-- +goose StatementEnd
