package db

import (
	"testing"

	"github.com/kannachi323/misty/server/security"
)

func TestSessionCRUDAndExpiry(t *testing.T) {
	database := openTestDatabase(t)

	user, err := database.CreateUser("Session User", "session@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	tokenHash := security.HashToken("session-token")
	if err := database.CreateSession(tokenHash, user.ID); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}

	userID, err := database.GetSessionUserID(tokenHash)
	if err != nil {
		t.Fatalf("GetSessionUserID() error = %v", err)
	}
	if userID != user.ID {
		t.Fatalf("GetSessionUserID() = %q, want %q", userID, user.ID)
	}

	if _, err := database.Conn.Exec(`UPDATE sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1`, tokenHash); err != nil {
		t.Fatalf("expire session update error = %v", err)
	}

	userID, err = database.GetSessionUserID(tokenHash)
	if err != nil {
		t.Fatalf("GetSessionUserID() after expiry error = %v", err)
	}
	if userID != "" {
		t.Fatalf("GetSessionUserID() after expiry = %q, want empty", userID)
	}

	if err := database.DeleteSession(tokenHash); err != nil {
		t.Fatalf("DeleteSession() error = %v", err)
	}
}
