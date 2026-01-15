-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS files (
    file_path VARCHAR(255) PRIMARY KEY,
    size BIGINT NOT NULL,
    mtime BIGINT NOT NULL,
    hash TEXT NOT NULL,
    is_dir BOOLEAN NOT NULL
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS files;
-- +goose StatementEnd
