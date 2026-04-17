-- +goose Up
-- +goose StatementBegin
ALTER TABLE sync_entries ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_entries ADD COLUMN last_error TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- SQLite didn't support DROP COLUMN until 3.35. Migration leaves the columns in
-- place on downgrade rather than rebuilding the table; they default to benign
-- values and older code ignores them.
-- +goose StatementEnd
