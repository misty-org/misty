package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kannachi323/misty/server/db"
	"github.com/kannachi323/misty/server/security"
)

const accountDeletionRetention = 30 * 24 * time.Hour

func (s *SpacesService) BeginAccountDeletion() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Password     string `json:"password"`
			Confirmation string `json:"confirmation"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if body.Confirmation != "DELETE" {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"code": "account_deletion_confirmation_required",
			})
			return
		}
		valid, err := s.database.VerifyUserPassword(r.Context(), userID, body.Password)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if !valid {
			writeJSON(w, http.StatusUnauthorized, map[string]string{
				"code": "account_reauthentication_failed",
			})
			return
		}
		blockers, err := s.database.AccountDeletionBlockers(r.Context(), userID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if len(blockers) > 0 {
			writeJSON(w, http.StatusConflict, map[string]any{
				"code":    "account_deletion_space_ownership",
				"message": "Transfer or delete every Space you own before deleting your account.",
				"spaces":  blockers,
			})
			return
		}

		statusToken := randomProviderValue(32)
		requestID := "deletion_" + uuid.NewString()
		request, err := s.database.BeginAccountDeletion(
			r.Context(), userID, requestID, security.HashToken(statusToken),
			accountDeletionRetention,
		)
		if errors.Is(err, db.ErrAccountDeletionBlocked) {
			writeJSON(w, http.StatusConflict, map[string]string{
				"code": "account_deletion_already_pending",
			})
			return
		}
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusAccepted, map[string]any{
			"request":      request,
			"status_token": statusToken,
		})
	}
}

func (s *SpacesService) AccountDeletionStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			RequestID   string `json:"request_id"`
			StatusToken string `json:"status_token"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		request, err := s.database.AccountDeletionStatus(
			r.Context(), strings.TrimSpace(body.RequestID),
			security.HashToken(strings.TrimSpace(body.StatusToken)),
		)
		if errors.Is(err, db.ErrAccountDeletionToken) {
			writeJSON(w, http.StatusNotFound, map[string]string{
				"code": "account_deletion_not_found",
			})
			return
		}
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, request)
	}
}

func (s *SpacesService) ProcessAccountDeletions(
	ctx context.Context, limit int,
) (int, error) {
	requests, err := s.database.ProcessingAccountDeletions(ctx, limit)
	if err != nil {
		return 0, err
	}
	completed := 0
	for _, request := range requests {
		status, processErr := s.revokeAccountProviders(ctx, request.UserID)
		if processErr == nil && s.avatarStore != nil {
			processErr = s.avatarStore.Delete(ctx, avatarObjectKey(request.UserID))
			if errors.Is(processErr, ErrLibraryObjectNotFound) {
				processErr = nil
			}
		}
		if processErr != nil {
			_ = s.database.RecordAccountDeletionFailure(
				ctx, request.ID, "provider_or_storage_cleanup_failed",
			)
			return completed, processErr
		}
		if err := s.database.ScheduleAccountDeletion(ctx, request.ID, status); err != nil {
			_ = s.database.RecordAccountDeletionFailure(
				ctx, request.ID, "database_cleanup_failed",
			)
			return completed, err
		}
		completed++
	}
	return completed, nil
}

func (s *SpacesService) PurgeDueAccountDeletions(
	ctx context.Context, limit int,
) (int, error) {
	requests, err := s.database.DueAccountDeletions(ctx, limit)
	if err != nil {
		return 0, err
	}
	completed := 0
	for _, request := range requests {
		if err := s.database.CompleteAccountDeletion(ctx, request.ID); err != nil {
			return completed, err
		}
		completed++
	}
	return completed, nil
}

func (s *SpacesService) revokeAccountProviders(
	ctx context.Context, userID string,
) (map[string]string, error) {
	connections, err := s.database.AccountDeletionConnections(ctx, userID)
	if err != nil {
		return nil, err
	}
	status := map[string]string{}
	for _, connection := range connections {
		key := connection.Provider + ":" + connection.ID
		connectionStatus, revokeErr := s.revokeCloudConnection(ctx, connection)
		status[key] = connectionStatus
		if revokeErr != nil {
			return status, revokeErr
		}
	}
	providerCredentials, err := s.database.AccountDeletionProviderCredentials(ctx, userID)
	if err != nil {
		return status, err
	}
	for _, credential := range providerCredentials {
		key := "integration:" + credential.Provider + ":" + credential.ID
		connectionStatus, revokeErr := s.revokeProviderCredential(ctx, credential)
		status[key] = connectionStatus
		if revokeErr != nil {
			return status, revokeErr
		}
	}
	return status, nil
}

func (s *SpacesService) revokeProviderCredential(
	ctx context.Context, credential db.ProviderCredential,
) (string, error) {
	plaintext, decryptErr := s.decryptProviderSecret(
		credential.Provider, credential.Ciphertext, credential.Nonce,
	)
	var secret cloudOAuthSecret
	if decryptErr != nil || json.Unmarshal(plaintext, &secret) != nil {
		return "credential_unreadable_local_revocation", nil
	}
	if credential.Provider != "google" {
		return "local_revocation", nil
	}
	token := firstNonempty(secret.Token.RefreshToken, secret.Token.AccessToken)
	if token == "" {
		return "no_token_local_revocation", nil
	}
	if err := postProviderRevocation(
		ctx, "https://oauth2.googleapis.com/revoke",
		url.Values{"token": {token}}, "",
	); err != nil {
		return "revocation_failed", fmt.Errorf("revoke Google integration credential: %w", err)
	}
	return "revoked", nil
}

func (s *SpacesService) revokeCloudConnection(
	ctx context.Context, connection db.CloudConnection,
) (string, error) {
	plaintext, decryptErr := s.decryptProviderSecret(
		connection.Provider,
		connection.CredentialCiphertext,
		connection.CredentialNonce,
	)
	var secret cloudOAuthSecret
	if decryptErr != nil || json.Unmarshal(plaintext, &secret) != nil {
		return "credential_unreadable_local_revocation", nil
	}
	switch connection.Provider {
	case "drive":
		token := firstNonempty(secret.Token.RefreshToken, secret.Token.AccessToken)
		if token == "" {
			return "no_token_local_revocation", nil
		}
		if err := postProviderRevocation(
			ctx,
			"https://oauth2.googleapis.com/revoke",
			url.Values{"token": {token}},
			"",
		); err != nil {
			return "revocation_failed", fmt.Errorf("revoke Google credential: %w", err)
		}
		return "revoked", nil
	case "dropbox":
		if secret.Token.AccessToken == "" {
			return "no_token_local_revocation", nil
		}
		if err := postProviderRevocation(
			ctx,
			"https://api.dropboxapi.com/2/auth/token/revoke",
			nil,
			secret.Token.AccessToken,
		); err != nil {
			return "revocation_failed", fmt.Errorf("revoke Dropbox credential: %w", err)
		}
		return "revoked", nil
	case "onedrive":
		// Microsoft does not expose a per-refresh-token revocation endpoint
		// for this delegated desktop flow. Erasing Misty's encrypted copy is
		// the supported revocation action; users can also remove Misty from
		// their Microsoft Account consent page.
		return "local_revocation", nil
	default:
		return "unknown_provider_local_revocation", nil
	}
}

func postProviderRevocation(
	ctx context.Context, endpoint string, values url.Values, bearer string,
) error {
	body := ""
	if values != nil {
		body = values.Encode()
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, endpoint, strings.NewReader(body),
	)
	if err != nil {
		return err
	}
	if values != nil {
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	response, err := (&http.Client{Timeout: 15 * time.Second}).Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("provider returned %s", response.Status)
	}
	return nil
}
