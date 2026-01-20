-- +goose Up
-- +goose StatementBegin
ALTER TABLE devices ADD COLUMN device_name TEXT;
ALTER TABLE devices ADD COLUMN mount_path TEXT;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE devices DROP COLUMN device_name;
ALTER TABLE devices DROP COLUMN mount_path;
-- +goose StatementEnd
