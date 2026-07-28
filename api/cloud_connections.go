package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
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

type cloudOAuthDefinition struct {
	ID, Name, AuthorizeURL, TokenURL, ClientIDEnv, ClientSecretEnv string
	Scopes                                                         []string
	PKCE                                                           bool
}

var cloudOAuthCatalog = map[string]cloudOAuthDefinition{
	"drive": {
		ID: "drive", Name: "Google Drive",
		AuthorizeURL: "https://accounts.google.com/o/oauth2/v2/auth",
		TokenURL:     "https://oauth2.googleapis.com/token",
		ClientIDEnv:  "MISTY_GOOGLE_DRIVE_CLIENT_ID", ClientSecretEnv: "MISTY_GOOGLE_DRIVE_CLIENT_SECRET",
		Scopes: []string{"openid", "email", "profile", "https://www.googleapis.com/auth/drive"},
		PKCE:   true,
	},
	"dropbox": {
		ID: "dropbox", Name: "Dropbox",
		AuthorizeURL: "https://www.dropbox.com/oauth2/authorize",
		TokenURL:     "https://api.dropboxapi.com/oauth2/token",
		ClientIDEnv:  "MISTY_DROPBOX_CLIENT_ID", ClientSecretEnv: "MISTY_DROPBOX_CLIENT_SECRET",
		PKCE: true,
	},
	"onedrive": {
		ID: "onedrive", Name: "Microsoft OneDrive",
		AuthorizeURL: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
		TokenURL:     "https://login.microsoftonline.com/common/oauth2/v2.0/token",
		ClientIDEnv:  "MISTY_ONEDRIVE_CLIENT_ID", ClientSecretEnv: "MISTY_ONEDRIVE_CLIENT_SECRET",
		Scopes: []string{"offline_access", "User.Read", "Files.ReadWrite.All"},
		PKCE:   true,
	},
}

type cloudOAuthSecret struct {
	Verifier, ClientID, ClientSecret string
	Custom                           bool
	Token                            providerTokenEnvelope
}

func (s *SpacesService) CloudConnections() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		items, err := s.database.CloudConnections(r.Context(), userID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		result := make([]map[string]any, 0, len(items))
		for _, item := range items {
			result = append(result, cloudConnectionJSON(item))
		}
		entitlements, err := s.database.EntitlementsForUser(r.Context(), userID)
		if err != nil {
			writeSpaceError(w, errors.New("account license is unavailable"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"connections": result,
			"limit": map[string]any{
				"used": len(result),
				"maximum": func() any {
					if entitlements.Plan == db.TierPro {
						return nil
					}
					return 1
				}(),
			},
		})
	}
}

func cloudConnectionJSON(item db.CloudConnection) map[string]any {
	return map[string]any{
		"id": item.ID, "provider": item.Provider, "name": item.Name,
		"account_id": item.AccountID, "account_display": item.AccountDisplay,
		"uses_custom_oauth_client": item.UsesCustomOAuthClient,
		"expires_at":               item.ExpiresAt, "created_at": item.CreatedAt, "updated_at": item.UpdatedAt,
	}
}

func (s *SpacesService) BeginCloudAuthorization() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		provider := chi.URLParam(r, "provider")
		definition, exists := cloudOAuthCatalog[provider]
		if !exists {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "cloud_provider_invalid"})
			return
		}
		var body struct {
			Name         string `json:"name"`
			ClientID     string `json:"clientID"`
			ClientSecret string `json:"clientSecret"`
			ReturnTo     string `json:"returnTo"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		body.Name, body.ClientID, body.ClientSecret = strings.TrimSpace(body.Name), strings.TrimSpace(body.ClientID), strings.TrimSpace(body.ClientSecret)
		if body.Name == "" || !validProviderReturnPath(body.ReturnTo) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "cloud_connection_invalid"})
			return
		}
		if (body.ClientID == "") != (body.ClientSecret == "") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "oauth_client_pair_required"})
			return
		}
		clientID, clientSecret, custom := body.ClientID, body.ClientSecret, body.ClientID != ""
		if !custom {
			clientID, clientSecret = strings.TrimSpace(os.Getenv(definition.ClientIDEnv)), strings.TrimSpace(os.Getenv(definition.ClientSecretEnv))
		}
		if clientID == "" || clientSecret == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "cloud_provider_not_configured"})
			return
		}
		connections, err := s.database.CloudConnections(r.Context(), userID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		entitlements, err := s.database.EntitlementsForUser(r.Context(), userID)
		if err != nil {
			writeSpaceError(w, errors.New("account license is unavailable"))
			return
		}
		replacingExisting := false
		for _, connection := range connections {
			if connection.Name == body.Name {
				replacingExisting = true
				break
			}
		}
		if entitlements.Plan != db.TierPro && len(connections) >= 1 && !replacingExisting {
			writeJSON(w, http.StatusForbidden, map[string]string{"code": "cloud_connection_limit", "message": "Free accounts can connect one cloud account."})
			return
		}

		state, verifier := randomProviderValue(32), randomProviderValue(48)
		secret, _ := json.Marshal(cloudOAuthSecret{Verifier: verifier, ClientID: clientID, ClientSecret: clientSecret, Custom: custom})
		ciphertext, nonce, err := s.encryptProviderSecret(provider, secret)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		expires := time.Now().UTC().Add(10 * time.Minute)
		if err := s.database.CreateCloudOAuthState(r.Context(), hashProviderValue(state), db.CloudOAuthState{
			UserID: userID, Provider: provider, ConnectionName: body.Name,
			SecretCiphertext: ciphertext, SecretNonce: nonce, ReturnTo: body.ReturnTo, ExpiresAt: expires,
		}); err != nil {
			writeSpaceError(w, err)
			return
		}
		callback := cloudCallbackURL(r, provider)
		params := url.Values{
			"client_id": {clientID}, "redirect_uri": {callback}, "response_type": {"code"}, "state": {state},
		}
		if len(definition.Scopes) > 0 {
			params.Set("scope", strings.Join(definition.Scopes, " "))
		}
		if definition.PKCE {
			sum := sha256Bytes(verifier)
			params.Set("code_challenge", sum)
			params.Set("code_challenge_method", "S256")
		}
		switch provider {
		case "drive":
			params.Set("access_type", "offline")
			params.Set("prompt", "consent")
		case "dropbox":
			params.Set("token_access_type", "offline")
		}
		writeJSON(w, http.StatusOK, map[string]any{"provider": provider, "authorization_url": definition.AuthorizeURL + "?" + params.Encode(), "state_expires_at": expires})
	}
}

func sha256Bytes(value string) string {
	sum := sha256.Sum256([]byte(value))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func (s *SpacesService) CloudAuthorizationCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		provider, code, state := chi.URLParam(r, "provider"), r.URL.Query().Get("code"), r.URL.Query().Get("state")
		definition, exists := cloudOAuthCatalog[provider]
		if !exists || code == "" || state == "" {
			writeSpaceError(w, db.ErrSpaceInvalid)
			return
		}
		stored, err := s.database.ConsumeCloudOAuthState(r.Context(), hashProviderValue(state))
		if err != nil || stored.Provider != provider {
			writeSpaceError(w, db.ErrSpaceInvalid)
			return
		}
		plaintext, err := s.decryptProviderSecret(provider, stored.SecretCiphertext, stored.SecretNonce)
		var secret cloudOAuthSecret
		if err != nil || json.Unmarshal(plaintext, &secret) != nil {
			writeSpaceError(w, errors.New("cloud authorization state is invalid"))
			return
		}
		token, err := exchangeCloudCode(r.Context(), definition, secret, code, cloudCallbackURL(r, provider))
		if err != nil || token.AccessToken == "" {
			writeJSON(w, http.StatusBadGateway, map[string]string{"code": "cloud_exchange_failed"})
			return
		}
		accountID, accountName := fetchCloudIdentity(r.Context(), provider, token)
		if accountID == "" {
			writeJSON(w, http.StatusBadGateway, map[string]string{"code": "cloud_identity_failed"})
			return
		}
		secret.Verifier, secret.Token = "", token
		encoded, _ := json.Marshal(secret)
		ciphertext, nonce, err := s.encryptProviderSecret(provider, encoded)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		var expiresAt *time.Time
		if token.ExpiresIn > 0 {
			value := time.Now().UTC().Add(time.Duration(token.ExpiresIn) * time.Second)
			expiresAt = &value
		}
		entitlements, err := s.database.EntitlementsForUser(r.Context(), stored.UserID)
		if err != nil {
			writeSpaceError(w, errors.New("account license is unavailable"))
			return
		}
		maximum := 1
		if entitlements.Plan == db.TierPro {
			maximum = 0
		}
		item, err := s.database.SaveCloudConnection(r.Context(), db.CloudConnection{
			UserID: stored.UserID, Provider: provider, Name: stored.ConnectionName,
			AccountID: accountID, AccountDisplay: accountName,
			CredentialCiphertext: ciphertext, CredentialNonce: nonce, KeyVersion: s.keyVer,
			UsesCustomOAuthClient: secret.Custom, ExpiresAt: expiresAt,
		}, maximum)
		if errors.Is(err, db.ErrCloudConnectionLimit) {
			writeJSON(w, http.StatusForbidden, map[string]string{"code": "cloud_connection_limit", "message": "Free accounts can connect one cloud account."})
			return
		}
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeProviderCompletionPage(w, definition.Name, item.AccountDisplay)
	}
}

func (s *SpacesService) CloudConnectionToken() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		item, err := s.database.CloudConnection(r.Context(), userID, chi.URLParam(r, "connectionID"))
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		plaintext, err := s.decryptProviderSecret(item.Provider, item.CredentialCiphertext, item.CredentialNonce)
		var secret cloudOAuthSecret
		if err != nil || json.Unmarshal(plaintext, &secret) != nil || secret.Token.AccessToken == "" {
			writeSpaceError(w, errors.New("cloud credential is invalid"))
			return
		}
		if item.ExpiresAt != nil && item.ExpiresAt.Before(time.Now().UTC().Add(5*time.Minute)) {
			definition := cloudOAuthCatalog[item.Provider]
			token, err := refreshCloudToken(r.Context(), definition, secret)
			if err != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "cloud_reauthorization_required"})
				return
			}
			secret.Token = token
			encoded, _ := json.Marshal(secret)
			item.CredentialCiphertext, item.CredentialNonce, err = s.encryptProviderSecret(item.Provider, encoded)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			item.KeyVersion = s.keyVer
			if token.ExpiresIn > 0 {
				value := time.Now().UTC().Add(time.Duration(token.ExpiresIn) * time.Second)
				item.ExpiresAt = &value
			}
			if err := s.database.UpdateCloudConnectionCredential(r.Context(), *item); err != nil {
				writeSpaceError(w, err)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]any{
			"connection_id": item.ID, "provider": item.Provider,
			"access_token": secret.Token.AccessToken, "token_type": firstNonempty(secret.Token.TokenType, "Bearer"),
			"expires_at": item.ExpiresAt, "api_base": cloudAPIBase(item.Provider),
		})
	}
}

func (s *SpacesService) DeleteCloudConnection() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if err := s.database.DeleteCloudConnection(r.Context(), userID, chi.URLParam(r, "connectionID")); err != nil {
			writeSpaceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func exchangeCloudCode(ctx context.Context, definition cloudOAuthDefinition, secret cloudOAuthSecret, code, redirect string) (providerTokenEnvelope, error) {
	values := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {redirect},
		"client_id": {secret.ClientID}, "client_secret": {secret.ClientSecret}, "code_verifier": {secret.Verifier}}
	return requestCloudToken(ctx, definition.TokenURL, values)
}

func refreshCloudToken(ctx context.Context, definition cloudOAuthDefinition, secret cloudOAuthSecret) (providerTokenEnvelope, error) {
	if secret.Token.RefreshToken == "" {
		return providerTokenEnvelope{}, errors.New("refresh token is missing")
	}
	values := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {secret.Token.RefreshToken},
		"client_id": {secret.ClientID}, "client_secret": {secret.ClientSecret}}
	token, err := requestCloudToken(ctx, definition.TokenURL, values)
	if token.RefreshToken == "" {
		token.RefreshToken = secret.Token.RefreshToken
	}
	return token, err
}

func requestCloudToken(ctx context.Context, endpoint string, values url.Values) (providerTokenEnvelope, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")
	response, err := (&http.Client{Timeout: 20 * time.Second}).Do(request)
	if err != nil {
		return providerTokenEnvelope{}, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil || response.StatusCode < 200 || response.StatusCode >= 300 {
		return providerTokenEnvelope{}, fmt.Errorf("cloud token endpoint returned %s", response.Status)
	}
	var token providerTokenEnvelope
	if err := json.Unmarshal(raw, &token); err != nil || token.AccessToken == "" {
		return providerTokenEnvelope{}, errors.New("cloud token response is invalid")
	}
	return token, nil
}

func fetchCloudIdentity(ctx context.Context, provider string, token providerTokenEnvelope) (string, string) {
	endpoint, method := "", http.MethodGet
	switch provider {
	case "drive":
		endpoint = "https://openidconnect.googleapis.com/v1/userinfo"
	case "dropbox":
		endpoint, method = "https://api.dropboxapi.com/2/users/get_current_account", http.MethodPost
	case "onedrive":
		endpoint = "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName"
	}
	request, _ := http.NewRequestWithContext(ctx, method, endpoint, nil)
	request.Header.Set("Authorization", firstNonempty(token.TokenType, "Bearer")+" "+token.AccessToken)
	if method == http.MethodPost {
		request.Header.Set("Content-Type", "application/json")
	}
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
	id := firstProviderString(value, "account_id", "id", "sub")
	name := firstProviderString(value, "name", "display_name", "displayName", "email", "userPrincipalName")
	return id, name
}

func cloudCallbackURL(r *http.Request, provider string) string {
	base := configuredPublicAPIBase()
	if base == "" {
		scheme := "https"
		if r.TLS == nil && (strings.HasPrefix(r.Host, "localhost") || strings.HasPrefix(r.Host, "127.0.0.1")) {
			scheme = "http"
		}
		base = scheme + "://" + r.Host + requestAPIPathPrefix(r.URL.Path)
	}
	return base + "/oauth/cloud/" + url.PathEscape(provider) + "/callback"
}

func cloudAPIBase(provider string) string {
	switch provider {
	case "drive":
		return "https://www.googleapis.com"
	case "dropbox":
		return "https://api.dropboxapi.com"
	case "onedrive":
		return "https://graph.microsoft.com/v1.0"
	default:
		return ""
	}
}

func firstNonempty(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}
