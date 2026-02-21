-- +goose Up
-- +goose StatementBegin
ALTER TABLE ms_tokens RENAME TO ms_users;
ALTER TABLE gd_tokens RENAME TO gd_users;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE ms_users RENAME TO ms_tokens;
ALTER TABLE gd_users RENAME TO gd_tokens;
-- +goose StatementEnd
