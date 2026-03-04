-- +goose Up
-- +goose StatementBegin
DROP TABLE IF EXISTS devices;

CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    peer_hostname VARCHAR(255) UNIQUE NOT NULL,
    peer_type VARCHAR(50) NOT NULL,
    peer_address VARCHAR(50) NOT NULL,
    device_name TEXT,
    mount_path TEXT,
    workspace_id TEXT REFERENCES workspaces(workspace_id),
    last_seen DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS devices;

CREATE TABLE devices (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(workspace_id),
    peer_hostname VARCHAR(255) UNIQUE NOT NULL,
    peer_type VARCHAR(50) NOT NULL,
    peer_address VARCHAR(50) NOT NULL,
    last_seen DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    device_name TEXT,
    mount_path TEXT
);
-- +goose StatementEnd
