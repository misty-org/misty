-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS dbx_users (
    user_id TEXT NOT NULL,
    dbx_user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    display_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    PRIMARY KEY (user_id, dbx_user_id)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS dbx_users;
-- +goose StatementEnd
