package rclone

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rclone/rclone/fs/config"
)

// userInfoTimeout is the cap we put on email-resolution HTTP calls. The
// caller runs this right after OAuth completes on the happy path, so the
// provider is already reachable; we just don't want a flaky network to
// stall the "Connected!" handoff.
const userInfoTimeout = 10 * time.Second

// ResolveUserEmail fetches the authenticated user's email from the provider
// for a remote that was just configured. Returns ("", nil) when we have no
// way to resolve it (unsupported backend, no OAuth token), and ("", err)
// on a genuine API/network failure.
//
// This runs at the tail of the remote-config flow so we can rename a
// freshly-created remote from an opaque "onedrive-<epoch>" to a
// human-readable "onedrive-<email>".
func ResolveUserEmail(ctx context.Context, name string) (string, error) {
	Init()

	remoteType, _ := config.FileGetValue(name, "type")
	if remoteType == "" {
		return "", fmt.Errorf("remote %q has no type", name)
	}

	tokenStr, _ := config.FileGetValue(name, "token")
	if tokenStr == "" {
		// local, sftp, s3 with static creds — nothing OAuth-shaped to read.
		return "", nil
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal([]byte(tokenStr), &token); err != nil || token.AccessToken == "" {
		return "", nil
	}

	ctx, cancel := context.WithTimeout(ctx, userInfoTimeout)
	defer cancel()

	switch remoteType {
	case "onedrive":
		if claimEmail := emailFromJWTClaims(token.AccessToken); claimEmail != "" {
			return claimEmail, nil
		}
		return fetchOneDriveEmail(ctx, token.AccessToken)
	case "drive":
		return fetchGoogleDriveEmail(ctx, token.AccessToken)
	case "dropbox":
		return fetchDropboxEmail(ctx, token.AccessToken)
	}
	return "", nil
}

func fetchOneDriveEmail(ctx context.Context, accessToken string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("graph /me: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var data struct {
		Mail              string `json:"mail"`
		UserPrincipalName string `json:"userPrincipalName"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	// `mail` is the canonical mailbox; `userPrincipalName` is the UPN and
	// only sometimes matches the mailbox. Prefer `mail` when present.
	if data.Mail != "" {
		return data.Mail, nil
	}
	return data.UserPrincipalName, nil
}

func emailFromJWTClaims(accessToken string) string {
	parts := strings.Split(accessToken, ".")
	if len(parts) != 3 {
		return ""
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}

	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}

	for _, key := range []string{"preferred_username", "upn", "email", "unique_name"} {
		value, _ := claims[key].(string)
		if strings.Contains(value, "@") {
			return value
		}
	}
	return ""
}

func fetchGoogleDriveEmail(ctx context.Context, accessToken string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("drive about.get: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var data struct {
		User struct {
			EmailAddress string `json:"emailAddress"`
		} `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	return data.User.EmailAddress, nil
}

func fetchDropboxEmail(ctx context.Context, accessToken string) (string, error) {
	// get_current_account is a POST with a null body (RPC-style).
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.dropboxapi.com/2/users/get_current_account", strings.NewReader("null"))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("dropbox get_current_account: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var data struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	return data.Email, nil
}
