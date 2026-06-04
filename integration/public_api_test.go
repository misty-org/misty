package integration

import (
	"net/http"
	"testing"

	"github.com/kannachi323/misty/server/api"
)

func TestPublicAccountResponsesHideLicenseID(t *testing.T) {
	database := openIntegrationDatabase(t)

	registerRec := performJSONRequest(t, api.Register(database), http.MethodPost, "/register", map[string]string{
		"name":     "Ada Lovelace",
		"email":    "ada@example.com",
		"password": "correct horse battery staple",
	})
	if registerRec.Code != http.StatusCreated {
		t.Fatalf("register status = %d, want %d, body = %q", registerRec.Code, http.StatusCreated, registerRec.Body.String())
	}

	registerBody := decodeJSONResponse(t, registerRec)
	if _, ok := registerBody["license_id"]; ok {
		t.Fatalf("register response unexpectedly exposed license_id: %#v", registerBody)
	}

	userID, ok := registerBody["user_id"].(string)
	if !ok || userID == "" {
		t.Fatalf("register response missing user_id: %#v", registerBody)
	}

	loginRec := performJSONRequest(t, api.Login(database), http.MethodPost, "/login", map[string]string{
		"email":    "ada@example.com",
		"password": "correct horse battery staple",
	})
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login status = %d, want %d, body = %q", loginRec.Code, http.StatusOK, loginRec.Body.String())
	}

	loginBody := decodeJSONResponse(t, loginRec)
	if _, ok := loginBody["license_id"]; ok {
		t.Fatalf("login response unexpectedly exposed license_id: %#v", loginBody)
	}

	sessionCookie := requireCookie(t, loginRec, sessionCookieName)

	meRec := performJSONRequest(t, api.GetMe(database), http.MethodGet, "/me", nil, sessionCookie)
	if meRec.Code != http.StatusOK {
		t.Fatalf("/me status = %d, want %d, body = %q", meRec.Code, http.StatusOK, meRec.Body.String())
	}

	meBody := decodeJSONResponse(t, meRec)
	if _, ok := meBody["license_id"]; ok {
		t.Fatalf("/me response unexpectedly exposed license_id: %#v", meBody)
	}
	if got, ok := meBody["allows_use"].(bool); !ok || !got {
		t.Fatalf("/me allows_use = %#v, want true", meBody["allows_use"])
	}
	if got, ok := meBody["tier"].(string); !ok || got != "basic" {
		t.Fatalf("/me tier = %#v, want basic", meBody["tier"])
	}
}
