package dropbox

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"github.com/kannachi323/misty/proxy/db"
)

func GetAccessToken(database *db.Database, userID, dbxUserID string) (string, error) {
	tokens, err := database.GetDBXUsers(userID)
	if err != nil {
		return "", fmt.Errorf("failed to get tokens: %w", err)
	}
	for _, t := range tokens {
		if t.DbxUserID == dbxUserID {
			if t.AccessToken == "" {
				return "", fmt.Errorf("no access token stored for dbx_user %s", dbxUserID)
			}
			return t.AccessToken, nil
		}
	}
	return "", fmt.Errorf("no token record for dbx_user %s", dbxUserID)
}

func RefreshToken(database *db.Database, userID, dbxUserID string) (string, error) {
	tokens, err := database.GetDBXUsers(userID)
	if err != nil {
		return "", fmt.Errorf("failed to get tokens: %w", err)
	}

	var existing *db.DBXUserRecord
	for _, t := range tokens {
		if t.DbxUserID == dbxUserID {
			existing = &t
			break
		}
	}
	if existing == nil || existing.RefreshToken == "" {
		return "", fmt.Errorf("no refresh token found for dbx_user %s", dbxUserID)
	}

	config := GetConfig()
	if config == nil {
		return "", fmt.Errorf("failed to get Dropbox config")
	}

	resp, err := http.PostForm(config.TokenURL, url.Values{
		"client_id":     {config.ClientID},
		"client_secret": {config.ClientSecret},
		"refresh_token": {existing.RefreshToken},
		"grant_type":    {"refresh_token"},
	})
	if err != nil {
		return "", fmt.Errorf("refresh request failed: %w", err)
	}
	defer resp.Body.Close()

	var tokenResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", fmt.Errorf("failed to parse refresh response: %w", err)
	}

	if errMsg, ok := tokenResp["error"]; ok {
		errDesc, _ := tokenResp["error_description"].(string)
		return "", fmt.Errorf("token refresh failed: %v - %s", errMsg, errDesc)
	}

	newAccessToken, _ := tokenResp["access_token"].(string)
	if newAccessToken == "" {
		return "", fmt.Errorf("no access token in refresh response")
	}

	// Dropbox may or may not return a new refresh token
	newRefreshToken := existing.RefreshToken
	if rt, ok := tokenResp["refresh_token"].(string); ok && rt != "" {
		newRefreshToken = rt
	}

	if err := database.StoreDBXUser(userID, dbxUserID, newAccessToken, newRefreshToken, existing.DisplayName, existing.Email); err != nil {
		return "", fmt.Errorf("failed to store refreshed token: %w", err)
	}

	fmt.Printf("[DBX Token] Refreshed token for user %s, dbx_user %s\n", userID, dbxUserID)
	return newAccessToken, nil
}
