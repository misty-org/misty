// Package testkit provides infrastructure shared by contract and integration
// suites. It is not imported by production code.
package testkit

import (
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"testing"

	envconfig "github.com/kannachi323/misty/server/internal/platform/config"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"

	"github.com/joho/godotenv"
)

const databaseLockID int64 = 621042

var loadEnvironmentOnce sync.Once

type databaseConfig struct {
	host     string
	port     string
	user     string
	password string
	name     string
	sslmode  string
}

// OpenDatabase opens, serializes, and resets the destructive test database.
func OpenDatabase(t testing.TB) *db.Database {
	t.Helper()
	LoadEnvironment()
	config := loadDatabaseConfig(t)

	connection, err := sql.Open("postgres", config.dsn())
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	if err := connection.Ping(); err != nil {
		_ = connection.Close()
		t.Fatalf("database ping failed: %v", err)
	}

	database := &db.Database{Conn: connection}
	if _, err := database.Conn.Exec(`SELECT pg_advisory_lock($1)`, databaseLockID); err != nil {
		t.Fatalf("failed to acquire test database lock: %v", err)
	}
	resetDatabase(t, database)

	t.Cleanup(func() {
		resetDatabase(t, database)
		if _, err := database.Conn.Exec(`SELECT pg_advisory_unlock($1)`, databaseLockID); err != nil {
			t.Fatalf("failed to release test database lock: %v", err)
		}
		database.Stop()
	})
	return database
}

// LoadEnvironment loads the repository dotenv file at most once for suites
// that need a secret before opening their first database connection.
func LoadEnvironment() {
	loadEnvironmentOnce.Do(func() { _ = godotenv.Load() })
}

// DatabaseDSN returns the test database connection string with a caller-owned
// runtime role substituted for the administrative role.
func DatabaseDSN(t testing.TB, user, password string) string {
	t.Helper()
	LoadEnvironment()
	config := loadDatabaseConfig(t)
	config.user = strings.TrimSpace(user)
	config.password = strings.TrimSpace(password)
	return config.dsn()
}

func loadDatabaseConfig(t testing.TB) databaseConfig {
	t.Helper()
	useTestPrefix := false
	for _, key := range []string{"HOST", "PORT", "USER", "PASSWORD", "NAME", "SSLMODE"} {
		if strings.TrimSpace(envconfig.Getenv("TEST_DB_"+key)) != "" {
			useTestPrefix = true
			break
		}
	}
	read := func(key string) string {
		if useTestPrefix {
			return strings.TrimSpace(envconfig.Getenv("TEST_DB_" + key))
		}
		return strings.TrimSpace(envconfig.Getenv("DB_" + key))
	}
	config := databaseConfig{
		host: read("HOST"), port: read("PORT"), user: read("USER"),
		password: read("PASSWORD"), name: read("NAME"), sslmode: read("SSLMODE"),
	}
	if config.port == "" {
		config.port = "5432"
	}
	if config.sslmode == "" {
		config.sslmode = "disable"
	}
	switch {
	case config.host == "":
		t.Fatal("missing integration DB host; set TEST_DB_HOST or DB_HOST")
	case config.user == "":
		t.Fatal("missing integration DB user; set TEST_DB_USER or DB_USER")
	case config.password == "":
		t.Fatal("missing integration DB password; set TEST_DB_PASSWORD or DB_PASSWORD")
	case config.name == "":
		t.Fatal("missing integration DB name; set TEST_DB_NAME or DB_NAME")
	}
	if !strings.Contains(strings.ToLower(config.name), "test") {
		t.Fatalf("refusing to reset non-test database %q", config.name)
	}
	return config
}

func (config databaseConfig) dsn() string {
	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		config.host, config.port, config.user, config.password, config.name, config.sslmode,
	)
}

func resetDatabase(t testing.TB, database *db.Database) {
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
