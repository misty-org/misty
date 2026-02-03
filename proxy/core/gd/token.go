package gd

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"github.com/kannachi323/misty/proxy/db"
)

func GetAccessToken(database *db.Database, userID, gdUserID string) (string, error) {
	tokens, err := database.GetGDUsers(userID)
	if err != nil {
		return "", fmt.Errorf("failed to get tokens: %w", err)
	}
	for _, t := range tokens {
		if t.GdUserID == gdUserID {
			if t.AccessToken == "" {
				return "", fmt.Errorf("no access token stored for gd_user %s", gdUserID)
			}
			return t.AccessToken, nil
		}
	}
	return "", fmt.Errorf("no token record for gd_user %s", gdUserID)
}

func RefreshToken(database *db.Database, userID, gdUserID string) (string, error) {
	tokens, err := database.GetGDUsers(userID)
	if err != nil {
		return "", fmt.Errorf("failed to get tokens: %w", err)
	}

	var existing *db.GDUserRecord
	for _, t := range tokens {
		if t.GdUserID == gdUserID {
			existing = &t
			break
		}
	}
	if existing == nil || existing.RefreshToken == "" {
		return "", fmt.Errorf("no refresh token found for gd_user %s", gdUserID)
	}

	config := GetConfig()
	if config == nil {
		return "", fmt.Errorf("failed to get GD config")
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

	// Google may or may not return a new refresh token
	newRefreshToken := existing.RefreshToken
	if rt, ok := tokenResp["refresh_token"].(string); ok && rt != "" {
		newRefreshToken = rt
	}

	if err := database.StoreGDUser(userID, gdUserID, newAccessToken, newRefreshToken, existing.DisplayName, existing.Email); err != nil {
		return "", fmt.Errorf("failed to store refreshed token: %w", err)
	}

	fmt.Printf("[GD Token] Refreshed token for user %s, gd_user %s\n", userID, gdUserID)
	return newAccessToken, nil
}
