package api

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	. "github.com/kannachi323/misty/server/internal/platform/httpapi"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

// A device's consent to changes reaches the tickets the other device gets, and
// only through that device's own pair setting.
func TestConnectedDeviceFileWritesReachTickets(t *testing.T) {
	database := openPresenceTestDatabase(t)
	user, err := database.CreateUser("Pair owner", uniqueTestEmail("device-file-writes"), "password123")
	if err != nil {
		t.Fatal(err)
	}
	token := newConversationTestBearerToken(t, database, user.ID)
	register := func(key, endpoint string) *db.TrustedDevice {
		digest := sha256.Sum256([]byte(key + user.ID))
		device, err := database.RegisterTrustedDevice(user.ID, key, base64.RawURLEncoding.EncodeToString(digest[:]), "macos", endpoint, json.RawMessage(`["misty-device/1"]`), json.RawMessage(`{}`))
		if err != nil {
			t.Fatal(err)
		}
		return device
	}
	first := register("first", strings.Repeat("c", 64))
	second := register("second", strings.Repeat("d", 64))
	hash := func(value string) string {
		digest := sha256.Sum256([]byte(value))
		return hex.EncodeToString(digest[:])
	}
	session, err := database.CreateDevicePairingSession(user.ID, first.ID, hash("qr"), hash("code"), time.Now().Add(5*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = database.RedeemDevicePairingSession(user.ID, second.ID, session.ID, hash("code")); err != nil {
		t.Fatal(err)
	}
	pair, err := database.ConfirmDevicePairing(user.ID, first.ID, session.ID)
	if err != nil {
		t.Fatal(err)
	}

	_, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	service := NewAgentsService(database)
	service.SetConnectedDevices(TestingConnectedDevicesConfig(privateKey, []byte(strings.Repeat("p", 32))))
	router := chi.NewRouter()
	router.Put("/devices/{deviceID}/pairs/{pairID}/file-writes", service.ConnectedDeviceFileWrites())
	router.Post("/devices/{deviceID}/peer-tickets", service.IssueConnectedDeviceTicket())

	permissions := func(source, target *db.TrustedDevice) []string {
		response := performConversationRequest(t, router, http.MethodPost, "/devices/"+source.ID+"/peer-tickets", token, map[string]any{"targetDeviceId": target.ID, "protocolVersion": "misty-device/1"})
		if response.Code != http.StatusCreated {
			t.Fatalf("ticket: %d %s", response.Code, response.Body.String())
		}
		var body struct {
			Ticket string `json:"ticket"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		raw, err := base64.RawURLEncoding.DecodeString(strings.Split(body.Ticket, ".")[1])
		if err != nil {
			t.Fatal(err)
		}
		var claims struct {
			Permissions []string `json:"permissions"`
		}
		if err := json.Unmarshal(raw, &claims); err != nil {
			t.Fatal(err)
		}
		return claims.Permissions
	}
	if slices.Contains(permissions(first, second), "files:write") {
		t.Fatal("changes must start off")
	}

	path := "/devices/" + second.ID + "/pairs/" + pair.ID + "/file-writes"
	if response := performConversationRequest(t, router, http.MethodPut, path, token, map[string]any{}); response.Code != http.StatusBadRequest {
		t.Fatalf("missing choice: %d", response.Code)
	}
	if response := performConversationRequest(t, router, http.MethodPut, path, "", map[string]any{"enabled": true}); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated: %d", response.Code)
	}
	if response := performConversationRequest(t, router, http.MethodPut, path, token, map[string]any{"enabled": true}); response.Code != http.StatusOK {
		t.Fatalf("allow changes: %d %s", response.Code, response.Body.String())
	}
	if !slices.Contains(permissions(first, second), "files:write") {
		t.Fatal("the first device's ticket must carry the second device's consent")
	}
	if slices.Contains(permissions(second, first), "files:write") {
		t.Fatal("consent is one-way: the first device did not allow changes")
	}
}
