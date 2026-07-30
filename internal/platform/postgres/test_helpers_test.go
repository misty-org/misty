package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/joho/godotenv"
)

var loadTestEnvOnce sync.Once

const testDatabaseLockID int64 = 621042

func loadTestEnv() {
	loadTestEnvOnce.Do(func() {
		_ = godotenv.Load()
	})
}

type integrationDBConfig struct {
	host     string
	port     string
	user     string
	password string
	name     string
	sslmode  string
}

func openTestDatabase(t *testing.T) *Database {
	t.Helper()

	loadTestEnv()
	cfg := loadIntegrationDBConfig(t)

	conn, err := sql.Open("postgres", cfg.dsn())
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	if err := conn.Ping(); err != nil {
		_ = conn.Close()
		t.Fatalf("database ping failed: %v", err)
	}

	database := &Database{Conn: conn}
	acquireTestDatabaseLock(t, database)
	resetTestDatabase(t, database)

	t.Cleanup(func() {
		resetTestDatabase(t, database)
		releaseTestDatabaseLock(t, database)
		database.Stop()
	})

	return database
}

func createTestSpace(t *testing.T, database *Database, ctx context.Context, ownerUserID, name string) *Space {
	t.Helper()
	space, err := database.CreateSpace(ctx, ownerUserID, name)
	if err != nil {
		t.Fatalf("CreateSpace(%q) error = %v", name, err)
	}
	return space
}

func loadIntegrationDBConfig(t *testing.T) integrationDBConfig {
	t.Helper()

	useTestPrefix := false
	for _, key := range []string{"HOST", "PORT", "USER", "PASSWORD", "NAME", "SSLMODE"} {
		if strings.TrimSpace(os.Getenv("TEST_DB_"+key)) != "" {
			useTestPrefix = true
			break
		}
	}

	read := func(key string) string {
		if useTestPrefix {
			return strings.TrimSpace(os.Getenv("TEST_DB_" + key))
		}
		return strings.TrimSpace(os.Getenv("DB_" + key))
	}

	cfg := integrationDBConfig{
		host:     read("HOST"),
		port:     read("PORT"),
		user:     read("USER"),
		password: read("PASSWORD"),
		name:     read("NAME"),
		sslmode:  read("SSLMODE"),
	}

	if cfg.port == "" {
		cfg.port = "5432"
	}
	if cfg.sslmode == "" {
		cfg.sslmode = "disable"
	}

	switch {
	case cfg.host == "":
		t.Fatal("missing integration DB host; set TEST_DB_HOST or DB_HOST")
	case cfg.user == "":
		t.Fatal("missing integration DB user; set TEST_DB_USER or DB_USER")
	case cfg.password == "":
		t.Fatal("missing integration DB password; set TEST_DB_PASSWORD or DB_PASSWORD")
	case cfg.name == "":
		t.Fatal("missing integration DB name; set TEST_DB_NAME or DB_NAME")
	}
	if !strings.Contains(strings.ToLower(strings.TrimSpace(cfg.name)), "test") {
		t.Fatalf("refusing to reset non-test database %q; configure TEST_DB_* or use a DB name containing \"test\"", cfg.name)
	}

	return cfg
}

func (cfg integrationDBConfig) dsn() string {
	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		cfg.host, cfg.port, cfg.user, cfg.password, cfg.name, cfg.sslmode,
	)
}

func resetTestDatabase(t *testing.T, database *Database) {
	t.Helper()

	_, err := database.Conn.Exec(`
		TRUNCATE TABLE
			stripe_purchases,
			sessions,
			password_reset_tokens,
			waitlist_signups,
			users,
			licenses
		RESTART IDENTITY CASCADE
	`)
	if err != nil {
		t.Fatalf("failed to reset test database: %v", err)
	}
}

func acquireTestDatabaseLock(t *testing.T, database *Database) {
	t.Helper()

	if _, err := database.Conn.Exec(`SELECT pg_advisory_lock($1)`, testDatabaseLockID); err != nil {
		t.Fatalf("failed to acquire test database lock: %v", err)
	}
}

func releaseTestDatabaseLock(t *testing.T, database *Database) {
	t.Helper()

	if _, err := database.Conn.Exec(`SELECT pg_advisory_unlock($1)`, testDatabaseLockID); err != nil {
		t.Fatalf("failed to release test database lock: %v", err)
	}
}
