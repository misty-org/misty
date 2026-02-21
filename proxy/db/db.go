package db

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/lib/pq"
)

type Database struct {
	Conn *sql.DB
}

func (db *Database) GetDSN() string {
	host := os.Getenv("DB_HOST")
	if host == "" {
		host = "localhost"
	}
	port := os.Getenv("DB_PORT")
	if port == "" {
		port = "5432"
	}
	user := os.Getenv("DB_USER")
	if user == "" {
		user = "misty"
	}
	password := os.Getenv("DB_PASSWORD")
	if password == "" {
		password = "misty"
	}
	dbname := os.Getenv("DB_NAME")
	if dbname == "" {
		dbname = "misty"
	}
	sslmode := os.Getenv("DB_SSLMODE")
	if sslmode == "" {
		sslmode = "disable"
	}

	return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		host, port, user, password, dbname, sslmode)
}

func (db *Database) StartDatabase() error {
	dsn := db.GetDSN()

	conn, err := sql.Open("postgres", dsn)
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
