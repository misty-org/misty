package api

import "testing"

func TestNormalizeWaitlistEmail(t *testing.T) {
	email, err := normalizeWaitlistEmail("  User+alias@Example.COM ")
	if err != nil {
		t.Fatalf("normalizeWaitlistEmail() error = %v", err)
	}
	if email != "user+alias@example.com" {
		t.Fatalf("normalizeWaitlistEmail() = %q, want %q", email, "user+alias@example.com")
	}
}

func TestNormalizeWaitlistEmailRejectsInvalid(t *testing.T) {
	if _, err := normalizeWaitlistEmail("not-an-email"); err == nil {
		t.Fatal("normalizeWaitlistEmail() succeeded for invalid address")
	}
}
