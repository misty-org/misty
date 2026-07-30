package api

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestTrustedDeviceSignatureBindsMethodPathNonceAndBody(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	payload := deviceSignaturePayload("POST", "/api/devices/device_123/workflow-node-jobs/claim", "1700000000", "unique-nonce-1234", []byte(`{"limit":1}`))
	signature := ed25519.Sign(privateKey, []byte(payload))
	if !ed25519.Verify(publicKey, []byte(payload), signature) {
		t.Fatal("valid signature rejected")
	}
	tampered := deviceSignaturePayload("POST", "/api/devices/device_123/workflow-node-jobs/claim", "1700000000", "unique-nonce-1234", []byte(`{"limit":2}`))
	if ed25519.Verify(publicKey, []byte(tampered), signature) {
		t.Fatal("tampered request reused a signature")
	}
}

func TestTrustedDeviceRegistrationIsStrict(t *testing.T) {
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key := base64.RawURLEncoding.EncodeToString(publicKey)
	if !validDeviceRegistration("My Mac", key, "ed25519", json.RawMessage(`{"workflowNodeLeases":true}`)) {
		t.Fatal("valid trusted device registration rejected")
	}
	if validDeviceRegistration("My Mac", key, "rsa", json.RawMessage(`{}`)) {
		t.Fatal("unsupported key algorithm accepted")
	}
	if validDeviceRegistration("My Mac", key, "ed25519", json.RawMessage(`{"libraryPath":"/Users/me"}`)) {
		t.Fatal("device capabilities leaked a local path")
	}
}
