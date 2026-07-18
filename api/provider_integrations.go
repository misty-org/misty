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
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/server/db"
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

func googleProvider(id, name string, scopes ...string) providerOAuthDefinition {
	return providerOAuthDefinition{ID: id, Name: name, AuthorizeURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token", ClientIDEnv: "GOOGLE_OAUTH_CLIENT_ID", ClientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET", Scopes: append(scopes, "openid", "email", "profile"), PKCE: true}
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
		clientID := strings.TrimSpace(os.Getenv(definition.ClientIDEnv))
		if clientID == "" || strings.TrimSpace(os.Getenv(definition.ClientSecretEnv)) == "" {
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
			writeSpaceError(w, err)
			return
		}
		http.Redirect(w, r, providerCompletionURL(provider, stored.ReturnTo), http.StatusSeeOther)
	}
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
	values := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {redirect}, "client_id": {strings.TrimSpace(os.Getenv(definition.ClientIDEnv))}, "client_secret": {strings.TrimSpace(os.Getenv(definition.ClientSecretEnv))}}
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

func providerCompletionURL(provider, returnTo string) string {
	base := strings.TrimSpace(os.Getenv("MISTY_DESKTOP_OAUTH_RETURN_URL"))
	if base == "" {
		base = configuredPublicAPIBase() + "/oauth/complete"
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme == "" {
		return "/"
	}
	query := parsed.Query()
	query.Set("provider", provider)
	query.Set("status", "connected")
	if strings.HasPrefix(returnTo, "/") {
		query.Set("return_to", returnTo)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func refreshProviderToken(ctx context.Context, definition providerOAuthDefinition, refreshToken string) (providerTokenEnvelope, []byte, error) {
	values := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refreshToken}, "client_id": {strings.TrimSpace(os.Getenv(definition.ClientIDEnv))}, "client_secret": {strings.TrimSpace(os.Getenv(definition.ClientSecretEnv))}}
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
