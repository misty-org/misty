-- +goose Up
-- +goose StatementBegin
CREATE TABLE users_new (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
);
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO users_new (id, name, email)
SELECT id, name, email FROM users
WHERE rowid IN (SELECT MIN(rowid) FROM users GROUP BY email);
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE users;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE users_new RENAME TO users;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE users ADD COLUMN password TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd
