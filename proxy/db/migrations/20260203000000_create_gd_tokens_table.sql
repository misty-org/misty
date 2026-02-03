-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS gd_tokens (
    user_id TEXT NOT NULL,
    gd_user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    display_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    PRIMARY KEY (user_id, gd_user_id)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS gd_tokens;
-- +goose StatementEnd
