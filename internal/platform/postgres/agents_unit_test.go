package db

import (
	"testing"
)

func TestWorkflowNodeLeaseTokensAreOpaqueAndHashed(t *testing.T) {
	token, err := secureToken()
	if err != nil {
		t.Fatalf("secureToken() error = %v", err)
	}
	if len(token) < 40 {
		t.Fatalf("lease token length = %d, want at least 40", len(token))
	}
	hash := hashToken(token)
	if hash == token || len(hash) != 64 {
		t.Fatalf("hashToken() returned unsafe digest %q", hash)
	}
	if hash != hashToken(token) {
		t.Fatal("lease token hashing is not deterministic")
	}
}
