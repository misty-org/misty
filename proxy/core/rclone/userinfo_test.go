package rclone

import (
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestEmailFromJWTClaims(t *testing.T) {
	claims := map[string]string{
		"preferred_username": "alice@example.com",
	}
	body, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}

	token := "header." + base64.RawURLEncoding.EncodeToString(body) + ".sig"
	if got := emailFromJWTClaims(token); got != "alice@example.com" {
		t.Fatalf("emailFromJWTClaims() = %q, want %q", got, "alice@example.com")
	}
}

func TestEmailFromJWTClaimsFallbackOrder(t *testing.T) {
	claims := map[string]string{
		"upn":         "bob@example.com",
		"unique_name": "ignored@example.com",
	}
	body, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}

	token := "header." + base64.RawURLEncoding.EncodeToString(body) + ".sig"
	if got := emailFromJWTClaims(token); got != "bob@example.com" {
		t.Fatalf("emailFromJWTClaims() = %q, want %q", got, "bob@example.com")
	}
}
