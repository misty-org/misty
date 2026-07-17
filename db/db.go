package db

import (
	"database/sql"
	"fmt"
	"log"
	"net"
	"os"
	"strings"

	_ "github.com/lib/pq"
)

type Database struct {
	Conn *sql.DB
}

func (db *Database) GetDSN() string {
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	user := os.Getenv("DB_USER")
	password := os.Getenv("DB_PASSWORD")
	name := os.Getenv("DB_NAME")

	if port == "" {
		port = "5432"
	}

	sslmode := databaseSSLMode(host)

	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		host, port, user, password, name, sslmode,
	)
}

func databaseSSLMode(host string) string {
	host = strings.TrimSpace(host)
	if strings.HasPrefix(host, "/") || strings.EqualFold(host, "localhost") || strings.EqualFold(host, "postgres") {
		return "disable"
	}
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil && ip.IsLoopback() {
		return "disable"
	}
	return "require"
}

func (db *Database) Start() error {
	conn, err := sql.Open("postgres", db.GetDSN())
	if err != nil {
		log.Println("Failed to open database:", err)
		return err
	}

	if err := conn.Ping(); err != nil {
		log.Println("Failed to connect to database:", err)
		return err
	}
	warnIfRoleBypassesRLS(conn)

	db.Conn = conn
	return nil
}

func (db *Database) Stop() {
	if db.Conn != nil {
		db.Conn.Close()
	}
}

func warnIfRoleBypassesRLS(conn *sql.DB) {
	var role string
	var bypassesRLS bool
	err := conn.QueryRow(`
		SELECT rolname, rolsuper OR rolbypassrls
		FROM pg_roles
		WHERE rolname = current_user
	`).Scan(&role, &bypassesRLS)
	if err != nil {
		log.Println("Failed to inspect database role RLS settings:", err)
		return
	}
	if bypassesRLS {
		log.Printf("WARNING: database role %q bypasses row-level security; use a non-superuser role without BYPASSRLS in production", role)
	}
}
