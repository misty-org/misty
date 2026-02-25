package db

import (
	"log"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

func (db *Database) InsertUser(name, email, password string) error {
    id := uuid.New().String()

    hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)

    _, err := db.Conn.Exec(`
        INSERT INTO users (id, name, email, password)
        VALUES (?, ?, ?, ?)`,
        id, name, email, hashedPassword,
    )
    if err != nil {
        log.Println("Failed to create user:", err)
    }
    return err
}

type UserInfo struct {
    ID    string
    Name  string
    Email string
}

func (db *Database) GetUser(email, password string) (*UserInfo, error) {
    var user UserInfo
    var storedHashedPassword string
    err := db.Conn.QueryRow(`
        SELECT id, name, email, password FROM users WHERE email = ?`,
        email,
    ).Scan(&user.ID, &user.Name, &user.Email, &storedHashedPassword)
    if err != nil {
        log.Println("Failed to get user:", err)
        return nil, err
    }

    err = bcrypt.CompareHashAndPassword([]byte(storedHashedPassword), []byte(password))
    if err != nil {
        log.Println("Invalid password:", err)
        return nil, err
    }

    return &user, nil
}
