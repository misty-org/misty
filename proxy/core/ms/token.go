package ms

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"github.com/kannachi323/misty/proxy/db"
)

func GetAccessToken(database *db.Database, userID, msUserID string) (string, error) {
	tokens, err := database.GetMSUsers(userID)
	if err != nil {
		return "", fmt.Errorf("failed to get tokens: %w", err)
	}
	for _, t := range tokens {
		if t.MsUserID == msUserID {
			if t.AccessToken == "" {
				return "", fmt.Errorf("no access token stored for ms_user %s", msUserID)
			}
			return t.AccessToken, nil
		}
	}
	return "", fmt.Errorf("no token record for ms_user %s", msUserID)
}

func RefreshToken(database *db.Database, userID, msUserID string) (string, error) {
	tokens, err := database.GetMSUsers(userID)
	if err != nil {
		return "", fmt.Errorf("failed to get tokens: %w", err)
	}

	var existing *db.MSUserRecord
	for _, t := range tokens {
		if t.MsUserID == msUserID {
			existing = &t
			break
		}
	}
	if existing == nil || existing.RefreshToken == "" {
		return "", fmt.Errorf("no refresh token found for ms_user %s", msUserID)
	}

	config := GetConfig()
	if config == nil {
		return "", fmt.Errorf("failed to get MS config")
	}

	resp, err := http.PostForm("https://login.microsoftonline.com/common/oauth2/v2.0/token", url.Values{
		"client_id":     {config.ClientID},
		"refresh_token": {existing.RefreshToken},
		"grant_type":    {"refresh_token"},
		"scope":         {config.GetScopesString()},
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
	newRefreshToken, _ := tokenResp["refresh_token"].(string)
	if newAccessToken == "" {
		return "", fmt.Errorf("no access token in refresh response")
	}

	if err := database.StoreMSUser(userID, msUserID, newAccessToken, newRefreshToken, existing.DisplayName, existing.Email); err != nil {
		return "", fmt.Errorf("failed to store refreshed token: %w", err)
	}

	fmt.Printf("[MS Token] Refreshed token for user %s, ms_user %s\n", userID, msUserID)
	return newAccessToken, nil
}