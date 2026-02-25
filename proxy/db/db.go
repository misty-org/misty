package db

import (
	"database/sql"
	"log"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

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

	return nil
}

func (db *Database) Stop() {
	if db.Conn != nil {
		db.Conn.Close()
	}
}
