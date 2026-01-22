-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    peer_hostname VARCHAR(255) UNIQUE NOT NULL,
    peer_type VARCHAR(50) NOT NULL,
    peer_address VARCHAR(50) NOT NULL,
    last_seen DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS devices;
-- +goose StatementEnd
