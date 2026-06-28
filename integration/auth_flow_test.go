package integration

import (
	"net/http"
	"testing"

	"github.com/kannachi323/misty/server/api"
)

func TestAuthLifecycle(t *testing.T) {
	database := openIntegrationDatabase(t)

	registerRec := performJSONRequest(t, api.Register(database), http.MethodPost, "/register", map[string]string{
		"name":     "Ada Lovelace",
		"email":    "ada@example.com",
		"password": "correct horse battery staple",
	})
	if registerRec.Code != http.StatusCreated {
		t.Fatalf("register status = %d, want %d, body = %q", registerRec.Code, http.StatusCreated, registerRec.Body.String())
	}

	loginRec := performJSONRequest(t, api.Login(database), http.MethodPost, "/login", map[string]string{
		"email":    "ada@example.com",
		"password": "correct horse battery staple",
	})
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login status = %d, want %d, body = %q", loginRec.Code, http.StatusOK, loginRec.Body.String())
	}

	sessionCookie := requireCookie(t, loginRec, sessionCookieName)
	if !sessionCookie.HttpOnly {
		t.Fatal("session cookie should be HttpOnly")
	}
	loginBody := decodeJSONResponse(t, loginRec)
	sessionToken, ok := loginBody["token"].(string)
	if !ok || sessionToken == "" {
		t.Fatalf("login response missing token: %#v", loginBody)
	}

	meRec := performJSONRequest(t, api.GetMe(database), http.MethodGet, "/me", nil, sessionCookie)
	if meRec.Code != http.StatusOK {
		t.Fatalf("/me status = %d, want %d, body = %q", meRec.Code, http.StatusOK, meRec.Body.String())
	}

	bearerMeRec := performBearerJSONRequest(t, api.GetMe(database), http.MethodGet, "/me", nil, sessionToken)
	if bearerMeRec.Code != http.StatusOK {
		t.Fatalf("bearer /me status = %d, want %d, body = %q", bearerMeRec.Code, http.StatusOK, bearerMeRec.Body.String())
	}

	logoutRec := performBearerJSONRequest(t, api.Logout(database), http.MethodPost, "/logout", nil, sessionToken)
	if logoutRec.Code != http.StatusOK {
		t.Fatalf("logout status = %d, want %d", logoutRec.Code, http.StatusOK)
	}

	meAfterLogout := performJSONRequest(t, api.GetMe(database), http.MethodGet, "/me", nil, sessionCookie)
	if meAfterLogout.Code != http.StatusUnauthorized {
		t.Fatalf("/me after logout status = %d, want %d", meAfterLogout.Code, http.StatusUnauthorized)
	}
}

func TestAuthHandlersErrorPaths(t *testing.T) {
	database := openIntegrationDatabase(t)

	if rec := performJSONRequest(t, api.Register(database), http.MethodPost, "/register", map[string]string{"email": "   ", "password": "pw"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("register missing email status = %d, want %d", rec.Code, http.StatusBadRequest)
	}

	if rec := performJSONRequest(t, api.Login(database), http.MethodPost, "/login", map[string]string{"email": "user@example.com"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("login missing password status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
