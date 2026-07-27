package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/server/db"
	"github.com/lib/pq"
)

type providerOAuthDefinition struct {
	ID, Name, AuthorizeURL, TokenURL, ClientIDEnv, ClientSecretEnv string
	Scopes                                                         []string
	PKCE                                                           bool
}

var providerOAuthCatalog = map[string]providerOAuthDefinition{
	// Google is one account-level OAuth connection. Product capabilities such as
	// Calendar, Gmail, and Drive remain separate adapters and add scopes through
	// incremental consent instead of creating separate credentials.
	"google":  googleProvider("google", "Google", "https://www.googleapis.com/auth/calendar.readonly"),
	"slack":   {ID: "slack", Name: "Slack", AuthorizeURL: "https://slack.com/oauth/v2/authorize", TokenURL: "https://slack.com/api/oauth.v2.access", ClientIDEnv: "SLACK_CLIENT_ID", ClientSecretEnv: "SLACK_CLIENT_SECRET", Scopes: []string{"app_mentions:read", "channels:history", "channels:read", "chat:write", "files:read", "groups:history", "groups:read", "reactions:read", "users:read"}},
	"discord": {ID: "discord", Name: "Discord", AuthorizeURL: "https://discord.com/oauth2/authorize", TokenURL: "https://discord.com/api/oauth2/token", ClientIDEnv: "DISCORD_CLIENT_ID", ClientSecretEnv: "DISCORD_CLIENT_SECRET", Scopes: []string{"bot", "applications.commands", "identify"}},
	"notion":  {ID: "notion", Name: "Notion", AuthorizeURL: "https://api.notion.com/v1/oauth/authorize", TokenURL: "https://api.notion.com/v1/oauth/token", ClientIDEnv: "NOTION_CLIENT_ID", ClientSecretEnv: "NOTION_CLIENT_SECRET"},
}

type providerOAuthAvailability struct {
	Provider   string `json:"provider"`
	Configured bool   `json:"configured"`
}

func providerOAuthAvailabilityCatalog() []providerOAuthAvailability {
	providers := make([]providerOAuthAvailability, 0, len(providerOAuthCatalog))
	for provider, definition := range providerOAuthCatalog {
		if provider != "google" && provider != "discord" && provider != "notion" {
			continue
		}
		providers = append(providers, providerOAuthAvailability{
			Provider:   provider,
			Configured: providerOAuthClientID(definition) != "" && providerOAuthClientSecret(definition) != "",
		})
	}
	sort.Slice(providers, func(i, j int) bool { return providers[i].Provider < providers[j].Provider })
	return providers
}

func providerOAuthClientID(definition providerOAuthDefinition) string {
	return strings.TrimSpace(os.Getenv(definition.ClientIDEnv))
}

func providerOAuthClientSecret(definition providerOAuthDefinition) string {
	return strings.TrimSpace(os.Getenv(definition.ClientSecretEnv))
}

func googleProvider(id, name string, scopes ...string) providerOAuthDefinition {
	return providerOAuthDefinition{ID: id, Name: name, AuthorizeURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token", ClientIDEnv: "GOOGLE_CLIENT_ID", ClientSecretEnv: "GOOGLE_CLIENT_SECRET", Scopes: append(scopes, "openid", "email", "profile"), PKCE: true}
}

type providerTokenEnvelope struct {
	AccessToken   string                     `json:"access_token"`
	RefreshToken  string                     `json:"refresh_token,omitempty"`
	TokenType     string                     `json:"token_type,omitempty"`
	Scope         string                     `json:"scope,omitempty"`
	ExpiresIn     int                        `json:"expires_in,omitempty"`
	IDToken       string                     `json:"id_token,omitempty"`
	Team          *struct{ ID, Name string } `json:"team,omitempty"`
	WorkspaceID   string                     `json:"workspace_id,omitempty"`
	WorkspaceName string                     `json:"workspace_name,omitempty"`
}

func (s *SpacesService) BeginProviderAuthorization() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		provider := chi.URLParam(r, "provider")
		definition, ok := providerOAuthCatalog[provider]
		if !ok {
			writeSpaceError(w, db.ErrSpaceInvalid)
			return
		}
		clientID := providerOAuthClientID(definition)
		if clientID == "" || providerOAuthClientSecret(definition) == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "provider_not_configured", "provider": provider})
			return
		}
		var body struct {
			ReturnTo string `json:"return_to"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if !validProviderReturnPath(body.ReturnTo) {
			writeSpaceError(w, db.ErrSpaceInvalid)
			return
		}
		state := randomProviderValue(32)
		verifier := randomProviderValue(48)
		ciphertext, nonce, err := s.encryptProviderSecret(provider, []byte(verifier))
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		expires := time.Now().UTC().Add(10 * time.Minute)
		if err := s.database.CreateProviderOAuthState(r.Context(), hashProviderValue(state), db.ProviderOAuthState{UserID: userID, SpaceID: chi.URLParam(r, "spaceID"), Provider: provider, VerifierCiphertext: ciphertext, VerifierNonce: nonce, ReturnTo: body.ReturnTo, ExpiresAt: expires}); err != nil {
			writeSpaceError(w, err)
			return
		}
		callback := providerCallbackURL(r, provider)
		params := url.Values{"client_id": {clientID}, "redirect_uri": {callback}, "response_type": {"code"}, "state": {state}}
		if len(definition.Scopes) > 0 {
			params.Set("scope", strings.Join(definition.Scopes, " "))
		}
		if definition.PKCE {
			sum := sha256.Sum256([]byte(verifier))
			params.Set("code_challenge", base64.RawURLEncoding.EncodeToString(sum[:]))
			params.Set("code_challenge_method", "S256")
		}
		switch provider {
		case "google":
			params.Set("access_type", "offline")
			params.Set("prompt", "consent")
			params.Set("include_granted_scopes", "true")
		case "discord":
			params.Set("permissions", "274878024704")
		case "notion":
			params.Set("owner", "user")
		}
		writeJSON(w, http.StatusOK, map[string]any{"provider": provider, "authorization_url": definition.AuthorizeURL + "?" + params.Encode(), "state_expires_at": expires})
	}
}

func validProviderReturnPath(value string) bool {
	if value == "" {
		return true
	}
	return strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "//") && !strings.ContainsAny(value, "\\\r\n")
}

func (s *SpacesService) ProviderAuthorizationCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		provider, code, state := chi.URLParam(r, "provider"), r.URL.Query().Get("code"), r.URL.Query().Get("state")
		definition, exists := providerOAuthCatalog[provider]
		if !exists || code == "" || state == "" {
			writeSpaceError(w, db.ErrSpaceInvalid)
			return
		}
		stored, err := s.database.ConsumeProviderOAuthState(r.Context(), hashProviderValue(state))
		if err != nil || stored.Provider != provider {
			writeSpaceError(w, db.ErrSpaceInvalid)
			return
		}
		verifier, err := s.decryptProviderSecret(provider, stored.VerifierCiphertext, stored.VerifierNonce)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		token, raw, err := exchangeProviderCode(r.Context(), definition, code, string(verifier), providerCallbackURL(r, provider))
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"code": "provider_exchange_failed"})
			return
		}
		if token.AccessToken == "" {
			writeJSON(w, http.StatusBadGateway, map[string]string{"code": "provider_token_missing"})
			return
		}
		accountID, accountName := providerAccountIdentity(provider, token, raw)
		if accountID == "" {
			accountID, accountName = fetchProviderAccountIdentity(r.Context(), provider, token)
		}
		if accountID == "" {
			accountID = hashProviderValue(token.AccessToken)[:16]
		}
		if accountName == "" {
			accountName = definition.Name + " account"
		}
		ciphertext, nonce, err := s.encryptProviderSecret(provider, raw)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		var expiresAt *time.Time
		if token.ExpiresIn > 0 {
			value := time.Now().UTC().Add(time.Duration(token.ExpiresIn) * time.Second)
			expiresAt = &value
		}
		scopes := definition.Scopes
		if token.Scope != "" {
			scopes = strings.Fields(strings.ReplaceAll(token.Scope, ",", " "))
		}
		_, err = s.database.SaveProviderCredential(r.Context(), db.ProviderCredential{SpaceID: stored.SpaceID, UserID: stored.UserID, Provider: provider, Ciphertext: ciphertext, Nonce: nonce, KeyVersion: s.keyVer, AccountID: accountID, AccountDisplay: accountName, ExpiresAt: expiresAt}, accountName, scopes)
		if err != nil {
			logProviderCallbackDatabaseFailure(provider, err)
			writeSpaceError(w, err)
			return
		}
		// Setup intent is optional. A provider connected later from Settings may
		// have no setup row, so absence is deliberately ignored.
		_ = s.database.SetSpaceSetupProviderStatus(
			r.Context(), stored.UserID, stored.SpaceID, provider, "authorized",
		)
		writeProviderCompletionPage(w, definition.Name, accountName)
	}
}

func logProviderCallbackDatabaseFailure(provider string, err error) {
	var databaseError *pq.Error
	if errors.As(err, &databaseError) {
		log.Printf("Provider OAuth callback persistence failed: provider=%s sqlstate=%s table=%s constraint=%s", provider, databaseError.Code, databaseError.Table, databaseError.Constraint)
		return
	}
	log.Printf("Provider OAuth callback persistence failed: provider=%s error_type=%T", provider, err)
}

func (s *SpacesService) DeleteProviderIntegration() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if err := s.database.DeleteProviderIntegration(r.Context(), userID, chi.URLParam(r, "integrationID")); err != nil {
			writeSpaceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *SpacesService) encryptProviderSecret(provider string, plaintext []byte) ([]byte, []byte, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}
	return s.aead.Seal(nil, nonce, plaintext, []byte("misty-provider-v2:"+provider)), nonce, nil
}

func (s *SpacesService) decryptProviderSecret(provider string, ciphertext, nonce []byte) ([]byte, error) {
	plaintext, err := s.aead.Open(nil, nonce, ciphertext, []byte("misty-provider-v2:"+provider))
	if err == nil || provider != "google" {
		return plaintext, err
	}
	// Existing Google Calendar credentials were sealed with the legacy provider
	// identifier. The migration changes only metadata, so retain a read path until
	// each credential is refreshed and sealed under the shared Google identity.
	return s.aead.Open(nil, nonce, ciphertext, []byte("misty-provider-v2:google_calendar"))
}

func (s *SpacesService) providerAccessToken(ctx context.Context, userID, spaceID, integrationID string) (string, string, error) {
	credential, err := s.database.ProviderCredential(ctx, userID, spaceID, integrationID)
	if err != nil {
		return "", "", err
	}
	plaintext, err := s.decryptProviderSecret(credential.Provider, credential.Ciphertext, credential.Nonce)
	if err != nil {
		return "", "", err
	}
	var token providerTokenEnvelope
	if json.Unmarshal(plaintext, &token) != nil || token.AccessToken == "" {
		return "", "", errors.New("provider credential is invalid")
	}
	if credential.ExpiresAt != nil && credential.ExpiresAt.Before(time.Now().UTC().Add(5*time.Minute)) {
		if token.RefreshToken == "" {
			return "", "", errors.New("provider connection requires reauthorization")
		}
		definition, exists := providerOAuthCatalog[credential.Provider]
		if !exists {
			return "", "", errors.New("provider configuration is missing")
		}
		refreshed, raw, refreshErr := refreshProviderToken(ctx, definition, token.RefreshToken)
		if refreshErr != nil {
			return "", "", refreshErr
		}
		if refreshed.RefreshToken == "" {
			refreshed.RefreshToken = token.RefreshToken
			raw, _ = json.Marshal(refreshed)
		}
		ciphertext, nonce, sealErr := s.encryptProviderSecret(credential.Provider, raw)
		if sealErr != nil {
			return "", "", sealErr
		}
		credential.Ciphertext, credential.Nonce, credential.KeyVersion = ciphertext, nonce, s.keyVer
		if refreshed.ExpiresIn > 0 {
			value := time.Now().UTC().Add(time.Duration(refreshed.ExpiresIn) * time.Second)
			credential.ExpiresAt = &value
		}
		if updateErr := s.database.UpdateProviderCredentialSecret(ctx, *credential); updateErr != nil {
			return "", "", updateErr
		}
		token = refreshed
	}
	return token.AccessToken, token.TokenType, nil
}

func exchangeProviderCode(ctx context.Context, definition providerOAuthDefinition, code, verifier, redirect string) (providerTokenEnvelope, []byte, error) {
	values := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {redirect}, "client_id": {providerOAuthClientID(definition)}, "client_secret": {providerOAuthClientSecret(definition)}}
	if definition.PKCE {
		values.Set("code_verifier", verifier)
	}
	var request *http.Request
	if definition.ID == "notion" {
		encoded, _ := json.Marshal(map[string]string{"grant_type": "authorization_code", "code": code, "redirect_uri": redirect})
		request, _ = http.NewRequestWithContext(ctx, http.MethodPost, definition.TokenURL, bytes.NewReader(encoded))
		request.Header.Set("Content-Type", "application/json")
		request.SetBasicAuth(values.Get("client_id"), values.Get("client_secret"))
	} else {
		request, _ = http.NewRequestWithContext(ctx, http.MethodPost, definition.TokenURL, strings.NewReader(values.Encode()))
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	request.Header.Set("Accept", "application/json")
	response, err := (&http.Client{Timeout: 20 * time.Second}).Do(request)
	if err != nil {
		return providerTokenEnvelope{}, nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil || response.StatusCode < 200 || response.StatusCode >= 300 {
		return providerTokenEnvelope{}, nil, fmt.Errorf("token exchange returned %s", response.Status)
	}
	var token providerTokenEnvelope
	if err := json.Unmarshal(raw, &token); err != nil {
		return token, raw, err
	}
	return token, raw, nil
}

var providerCompletionPage = template.Must(template.New("provider-completion").Parse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{.Provider}} connected</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #090b0f; color: #f4f7fb; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 50% 0%, #1b2635 0, #090b0f 42rem); }
    main { width: min(30rem, calc(100vw - 2rem)); padding: 2rem; border: 1px solid rgba(255,255,255,.12); border-radius: 1rem; background: rgba(15,18,24,.88); box-shadow: 0 24px 80px rgba(0,0,0,.36); text-align: center; }
    .mark { width: 3rem; height: 3rem; margin: 0 auto 1rem; display: grid; place-items: center; border-radius: 999px; background: #16a34a; color: white; font-size: 1.75rem; font-weight: 700; }
    h1 { margin: 0; font-size: 1.35rem; line-height: 1.2; }
    p { margin: .75rem 0 0; color: #aab4c3; line-height: 1.55; }
    strong { color: #f4f7fb; font-weight: 650; }
  </style>
</head>
<body>
  <main>
    <div class="mark">&check;</div>
    <h1>{{.Provider}} is connected</h1>
    <p>Misty saved <strong>{{.Account}}</strong>. Return to the Misty app to continue.</p>
    <p>You can close this browser tab.</p>
  </main>
</body>
</html>`))

func writeProviderCompletionPage(w http.ResponseWriter, providerName, accountName string) {
	if strings.TrimSpace(accountName) == "" {
		accountName = providerName + " account"
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Frame-Options", "DENY")
	w.WriteHeader(http.StatusOK)
	_ = providerCompletionPage.Execute(w, map[string]string{"Provider": providerName, "Account": accountName})
}

func refreshProviderToken(ctx context.Context, definition providerOAuthDefinition, refreshToken string) (providerTokenEnvelope, []byte, error) {
	values := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refreshToken}, "client_id": {providerOAuthClientID(definition)}, "client_secret": {providerOAuthClientSecret(definition)}}
	var request *http.Request
	if definition.ID == "notion" {
		encoded, _ := json.Marshal(map[string]string{"grant_type": "refresh_token", "refresh_token": refreshToken})
		request, _ = http.NewRequestWithContext(ctx, http.MethodPost, definition.TokenURL, bytes.NewReader(encoded))
		request.Header.Set("Content-Type", "application/json")
		request.SetBasicAuth(values.Get("client_id"), values.Get("client_secret"))
	} else {
		request, _ = http.NewRequestWithContext(ctx, http.MethodPost, definition.TokenURL, strings.NewReader(values.Encode()))
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	request.Header.Set("Accept", "application/json")
	response, err := (&http.Client{Timeout: 20 * time.Second}).Do(request)
	if err != nil {
		return providerTokenEnvelope{}, nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil || response.StatusCode < 200 || response.StatusCode >= 300 {
		return providerTokenEnvelope{}, nil, fmt.Errorf("token refresh returned %s", response.Status)
	}
	var token providerTokenEnvelope
	if err := json.Unmarshal(raw, &token); err != nil {
		return token, raw, err
	}
	if token.AccessToken == "" {
		return token, raw, errors.New("token refresh did not return access token")
	}
	return token, raw, nil
}

func fetchProviderAccountIdentity(ctx context.Context, provider string, token providerTokenEnvelope) (string, string) {
	endpoint, method := "", http.MethodGet
	switch provider {
	case "google":
		endpoint = "https://openidconnect.googleapis.com/v1/userinfo"
	case "discord":
		endpoint = "https://discord.com/api/v10/users/@me"
	default:
		return "", ""
	}
	request, _ := http.NewRequestWithContext(ctx, method, endpoint, nil)
	kind := token.TokenType
	if kind == "" {
		kind = "Bearer"
	}
	request.Header.Set("Authorization", kind+" "+token.AccessToken)
	request.Header.Set("Accept", "application/json")
	response, err := (&http.Client{Timeout: 15 * time.Second}).Do(request)
	if err != nil {
		return "", ""
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", ""
	}
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	var value map[string]any
	_ = json.Unmarshal(raw, &value)
	id := firstProviderString(value, "id", "account_id", "sub")
	name := firstProviderString(value, "displayName", "name", "email", "login", "userPrincipalName")
	return id, name
}

func firstProviderString(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if text, ok := value[key].(string); ok && text != "" {
			return text
		}
	}
	return ""
}

func providerAccountIdentity(provider string, token providerTokenEnvelope, raw []byte) (string, string) {
	if token.Team != nil {
		return token.Team.ID, token.Team.Name
	}
	if token.WorkspaceID != "" {
		return token.WorkspaceID, token.WorkspaceName
	}
	var values map[string]any
	_ = json.Unmarshal(raw, &values)
	for _, pair := range [][2]string{{"account_id", "account_name"}, {"user_id", "user_name"}, {"guild_id", "guild_name"}} {
		id, _ := values[pair[0]].(string)
		name, _ := values[pair[1]].(string)
		if id != "" {
			return id, name
		}
	}
	return "", ""
}

func providerCallbackURL(r *http.Request, provider string) string {
	base := configuredPublicAPIBase()
	if base == "" {
		scheme := "https"
		if r.TLS == nil && (strings.HasPrefix(r.Host, "localhost") || strings.HasPrefix(r.Host, "127.0.0.1")) {
			scheme = "http"
		}
		base = scheme + "://" + r.Host + requestAPIPathPrefix(r.URL.Path)
	}
	return base + "/oauth/providers/" + url.PathEscape(provider) + "/callback"
}

func configuredPublicAPIBase() string {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("MISTY_PUBLIC_API_URL")), "/")
	if base == "" {
		return ""
	}
	parsed, err := url.Parse(base)
	if err == nil && parsed.Scheme != "" && parsed.Host != "" && (parsed.Path == "" || parsed.Path == "/") {
		// Compatibility for existing origin-only deployments. New configuration
		// should always include the complete API path explicitly.
		return base + "/api"
	}
	return base
}

func requestAPIPathPrefix(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || parts[0] != "api" {
		return ""
	}
	prefix := "/api"
	if len(parts) > 1 && isAPIVersionSegment(parts[1]) {
		prefix += "/" + parts[1]
	}
	return prefix
}

func isAPIVersionSegment(value string) bool {
	if len(value) < 2 || value[0] != 'v' {
		return false
	}
	for _, char := range value[1:] {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func randomProviderValue(size int) string {
	value := make([]byte, size)
	_, _ = rand.Read(value)
	return base64.RawURLEncoding.EncodeToString(value)
}
func hashProviderValue(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
