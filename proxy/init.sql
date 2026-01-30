CREATE TABLE IF NOT EXISTS files (
    file_path VARCHAR(255) NOT NULL PRIMARY KEY,
    mtime BIGINT NOT NULL,
    size BIGINT NOT NULL,
    is_dir BOOLEAN,
    hash TEXT
);

CREATE TABLE IF NOT EXISTS workspaces (
    workspace_id TEXT PRIMARY KEY,
    mount_path TEXT NOT NULL,
    workspace_name TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(workspace_id),
    peer_hostname VARCHAR(255) UNIQUE NOT NULL,
    peer_type VARCHAR(50) NOT NULL,
    peer_address VARCHAR(50) NOT NULL,
    last_seen TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    device_name TEXT,
    mount_path TEXT
);

CREATE TABLE IF NOT EXISTS ms_users (
    user_id TEXT NOT NULL,
    ms_user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    display_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    PRIMARY KEY (user_id, ms_user_id)
);

CREATE TABLE IF NOT EXISTS gd_users (
    user_id TEXT NOT NULL,
    gd_user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    display_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    PRIMARY KEY (user_id, gd_user_id)
);

CREATE TABLE IF NOT EXISTS dbx_users (
    user_id TEXT NOT NULL,
    dbx_user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    display_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    PRIMARY KEY (user_id, dbx_user_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

CREATE TABLE IF NOT EXISTS goose_db_version (
    id SERIAL PRIMARY KEY,
    version_id INTEGER NOT NULL,
    is_applied BOOLEAN NOT NULL,
    tstamp TIMESTAMP DEFAULT now()
);
