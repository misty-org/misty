package db

import (
	"database/sql"
	_ "embed"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

//go:embed sql/init.sql
var sqliteInitSQL string

type Database struct {
	Conn *sql.DB
}

func (db *Database) GetDSN() string {
	path := os.Getenv("DB_PATH")
	if path == "" {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, "misty", "db", "data.db")
	}
	return path
}

func (db *Database) StartDatabase() error {
	dsn := db.GetDSN()
	if dsn != "" && dsn != ":memory:" && !strings.HasPrefix(dsn, "file:") {
		if dir := filepath.Dir(dsn); dir != "" && dir != "." && dir != string(filepath.Separator) {
			if err := os.MkdirAll(dir, 0700); err != nil {
				log.Println("Failed to create database directory:", err)
				return err
			}
		}
	}

	conn, err := sql.Open("sqlite3", dsn+"?_foreign_keys=on")
	if err != nil {
		log.Println("Failed to open database: ", err)
		return err
	}

	if err := conn.Ping(); err != nil {
		log.Println("Failed to connect to database: ", err)
		return err
	}

	db.Conn = conn

	if err := ensureAuthSchema(conn); err != nil {
		log.Println("Failed to ensure auth schema:", err)
		_ = conn.Close()
		return err
	}

	if err := ensureSyncSchema(conn); err != nil {
		log.Println("Failed to ensure sync schema: ", err)
		_ = conn.Close()
		return err
	}

	if err := (&Database{Conn: conn}).CleanupExpiredAccessTokenRevocations(time.Now().UTC()); err != nil {
		log.Println("Failed to cleanup expired access token revocations:", err)
		_ = conn.Close()
		return err
	}

	return nil
}

func (db *Database) Stop() {
	if db.Conn != nil {
		db.Conn.Close()
	}
}

func ensureAuthSchema(conn *sql.DB) error {
	if err := ensureBootstrapSchema(conn); err != nil {
		return err
	}

	if err := addColumnIfMissing(conn, "users", "token_valid_after", "TEXT"); err != nil {
		return err
	}
	if err := addColumnIfMissing(conn, "refresh_tokens", "encrypted_token", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}

	// If the users table was created by an older migration that included a
	// password column, the column is harmless for reads but INSERT will fail
	// the NOT NULL constraint. Drop it if present.
	return dropColumnIfPresent(conn, "users", "password")
}

// dropColumnIfPresent rebuilds the table without the named column when SQLite
// is too old to support ALTER TABLE … DROP COLUMN (pre-3.35).
func dropColumnIfPresent(conn *sql.DB, table, column string) error {
	rows, err := conn.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return err
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var cid, notnull, pk int
		var name, ctype string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == column {
			found = true
			break
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if !found {
		return nil
	}

	// Rebuild without the unwanted column.
	_, err = conn.Exec(`
CREATE TABLE IF NOT EXISTS users_migrated (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
);
INSERT OR IGNORE INTO users_migrated (id, name, email)
    SELECT id, name, email FROM users;
DROP TABLE users;
ALTER TABLE users_migrated RENAME TO users;
`)
	return err
}

func ensureSyncSchema(conn *sql.DB) error {
	if err := ensureBootstrapSchema(conn); err != nil {
		return err
	}

	// Additive migrations for columns added after the initial schema shipped.
	// SQLite doesn't support "ADD COLUMN IF NOT EXISTS", so probe table_info
	// before issuing the ALTER.
	if err := addColumnIfMissing(conn, "sync_entries", "retry_count", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := addColumnIfMissing(conn, "sync_entries", "last_error", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return nil
}

func addColumnIfMissing(conn *sql.DB, table, column, columnDef string) error {
	rows, err := conn.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = conn.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, columnDef))
	return err
}

func ensureBootstrapSchema(conn *sql.DB) error {
	if strings.TrimSpace(sqliteInitSQL) == "" {
		return fmt.Errorf("embedded sqlite init.sql is empty")
	}
	_, err := conn.Exec(sqliteInitSQL)
	return err
}
