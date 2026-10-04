package api

import (
	"bytes"
	"encoding/json"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
	"testing"
)

func TestAIProviderKeysAreBoundToAccountConnectionAndProvider(t *testing.T) {
	s, err := NewSpacesService(nil, nil, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, nonce, err := s.encryptAIKey("owner", "connection", "openai", "fixture-key")
	if err != nil || bytes.Contains(ciphertext, []byte("fixture-key")) {
		t.Fatal("credential was not encrypted")
	}
	c := &db.AIProviderConnection{ID: "connection", Provider: "openai", Ciphertext: ciphertext, Nonce: nonce}
	key, err := s.decryptAIKey("owner", c)
	if err != nil || key != "fixture-key" {
		t.Fatal("credential did not round trip")
	}
	if _, err = s.decryptAIKey("other", c); err == nil {
		t.Fatal("cross-account decryption succeeded")
	}
	c.ID = "other-connection"
	if _, err = s.decryptAIKey("owner", c); err == nil {
		t.Fatal("cross-connection decryption succeeded")
	}
	c.ID = "connection"
	c.Provider = "gateway"
	if _, err = s.decryptAIKey("owner", c); err == nil {
		t.Fatal("cross-provider decryption succeeded")
	}
	c.Provider = "openai"
	c.Ciphertext[0] ^= 1
	if _, err = s.decryptAIKey("owner", c); err == nil {
		t.Fatal("tampered credential accepted")
	}
}
func TestAIProviderPublicConnectionNeverContainsSecretMaterial(t *testing.T) {
	raw, err := json.Marshal(db.AIProviderConnection{ID: "connection", Provider: "openai", Ciphertext: []byte("fixture-key"), Nonce: []byte("fixture-nonce")})
	if err != nil || bytes.Contains(raw, []byte("ciphertext")) || bytes.Contains(raw, []byte("nonce")) || bytes.Contains(raw, []byte("fixture")) {
		t.Fatal("secret material escaped through the public connection")
	}
}
