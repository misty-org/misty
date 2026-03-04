-- +goose Up
-- +goose StatementBegin
CREATE TABLE license_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token TEXT NOT NULL,
    tier TEXT NOT NULL,
    expires_at DATETIME NOT NULL
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS license_cache;
-- +goose StatementEnd
