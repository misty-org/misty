package ms

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/ms"
	"github.com/kannachi323/misty/proxy/db"
)

type MSUserProfile struct {
	ID                string `json:"id"`
	DisplayName       string `json:"displayName"`
	Mail              string `json:"mail"`
	UserPrincipalName string `json:"userPrincipalName"`
}

// Email returns mail if available, otherwise userPrincipalName
func (p MSUserProfile) Email() string {
	if p.Mail != "" {
		return p.Mail
	}
	return p.UserPrincipalName
}

func FetchMSUserProfile(accessToken string) (*MSUserProfile, error) {
	graphBase := "https://graph.microsoft.com/v1.0"
	req, err := http.NewRequest(http.MethodGet, graphBase+"/me", nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("graph request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 {
		return nil, fmt.Errorf("token invalid or expired")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("graph returned %d", resp.StatusCode)
	}

	var profile MSUserProfile
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return nil, fmt.Errorf("decode /me: %w", err)
	}
	if profile.ID == "" {
		return nil, fmt.Errorf("missing id in /me response")
	}
	return &profile, nil
}

// FetchMSUserID is kept for backwards compatibility
func FetchMSUserID(accessToken string) (string, error) {
	profile, err := FetchMSUserProfile(accessToken)
	if err != nil {
		return "", err
	}
	return profile.ID, nil
}

// MSUserInfo is the public response for the /ms/users endpoint — no tokens exposed.
type MSUserInfo struct {
	MsUserID    string `json:"ms_user_id"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Connected   bool   `json:"connected"`
}

func GetMSUsers(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		if userID == "" {
			http.Error(w, "user_id parameter is required", http.StatusBadRequest)
			return
		}

		if database == nil {
			http.Error(w, "Database not available", http.StatusInternalServerError)
			return
		}

		users, err := database.GetMSUsers(userID)
		if err != nil {
			http.Error(w, "Failed to get users: "+err.Error(), http.StatusInternalServerError)
			return
		}

		result := make([]MSUserInfo, 0, len(users))
		for _, u := range users {
			info := MSUserInfo{
				MsUserID:    u.MsUserID,
				DisplayName: u.DisplayName,
				Email:       u.Email,
				Connected:   false,
			}

			// Validate token by calling MS Graph /me
			_, err := FetchMSUserProfile(u.AccessToken)
			if err != nil {
				// Try refreshing the token
				newToken, refreshErr := ms.RefreshToken(database, userID, u.MsUserID)
				if refreshErr == nil && newToken != "" {
					// Re-validate with refreshed token
					_, err2 := FetchMSUserProfile(newToken)
					if err2 == nil {
						info.Connected = true
					}
				}
			} else {
				info.Connected = true
			}

			result = append(result, info)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}
