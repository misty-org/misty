package dbx

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/kannachi323/misty/proxy/core/dropbox"
	"github.com/kannachi323/misty/proxy/core/utils"
	"github.com/kannachi323/misty/proxy/db"
)

func GetOAuthLogin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		config := dropbox.GetConfig()
		if config == nil {
			http.Error(w, "Dropbox config not found", http.StatusInternalServerError)
			return
		}

		userID := r.URL.Query().Get("user_id")
		if userID == "" {
			http.Error(w, "user_id is required", http.StatusBadRequest)
			return
		}

		csrfToken, err := utils.GenerateCSRFToken()
		if err != nil {
			log.Printf("Failed to generate CSRF token: %v", err)
			http.Error(w, "Failed to initiate OAuth", http.StatusInternalServerError)
			return
		}

		http.SetCookie(w, &http.Cookie{
			Name:     utils.CSRFCookieName,
			Value:    csrfToken,
			Path:     "/api/dbx/callback",
			MaxAge:   300,
			HttpOnly: true,
			Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
			SameSite: http.SameSiteLaxMode,
		})

		state := dropbox.OAuthState{UserID: userID, CSRFToken: csrfToken}
		stateJSON, _ := json.Marshal(state)
		stateEncoded := base64.URLEncoding.EncodeToString(stateJSON)

		params := url.Values{
			"client_id":              {config.ClientID},
			"redirect_uri":           {config.RedirectURI},
			"response_type":          {"code"},
			"state":                  {stateEncoded},
			"token_access_type":      {"offline"},
			"force_reauthentication": {"true"},
		}

		authURL := fmt.Sprintf("%s?%s", config.AuthURL, params.Encode())

		http.Redirect(w, r, authURL, http.StatusFound)
	}
}

func OAuthCallback(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		config := dropbox.GetConfig()
		code := r.URL.Query().Get("code")
		stateParam := r.URL.Query().Get("state")

		// Decode state parameter to get user_id and CSRF token
		var state dropbox.OAuthState
		if stateParam != "" {
			decoded, err := base64.URLEncoding.DecodeString(stateParam)
			if err == nil {
				json.Unmarshal(decoded, &state)
			}
		}

		if code == "" || state.UserID == "" {
			log.Printf("code or user_id is empty - code: %s, userID: %s", code, state.UserID)
			ServeDBXAuthHTML(w, false)
			return
		}

		// Validate CSRF token from cookie
		csrfCookie, err := r.Cookie(utils.CSRFCookieName)
		if err != nil || csrfCookie.Value == "" {
			log.Printf("CSRF cookie missing or empty")
			ServeDBXAuthHTML(w, false)
			return
		}

		// Constant-time comparison to prevent timing attacks
		if subtle.ConstantTimeCompare([]byte(csrfCookie.Value), []byte(state.CSRFToken)) != 1 {
			log.Printf("CSRF token mismatch")
			ServeDBXAuthHTML(w, false)
			return
		}

		// Clear the CSRF cookie
		http.SetCookie(w, &http.Cookie{
			Name:     utils.CSRFCookieName,
			Value:    "",
			Path:     "/api/dbx/callback",
			MaxAge:   -1,
			HttpOnly: true,
		})

		userID := state.UserID

		resp, err := http.PostForm(config.TokenURL, url.Values{
			"client_id":     {config.ClientID},
			"client_secret": {config.ClientSecret},
			"code":          {code},
			"redirect_uri":  {config.RedirectURI},
			"grant_type":    {"authorization_code"},
		})
		if err != nil {
			log.Printf("Failed to exchange code for token: %v", err)
			ServeDBXAuthHTML(w, false)
			return
		}
		defer resp.Body.Close()

		var tokenResp map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
			log.Printf("Failed to decode token response: %v", err)
			ServeDBXAuthHTML(w, false)
			return
		}
		if _, ok := tokenResp["error"]; ok {
			log.Printf("Token exchange error: %v", tokenResp["error"])
			ServeDBXAuthHTML(w, false)
			return
		}

		var refreshToken, accessToken string
		if token, ok := tokenResp["access_token"].(string); ok && token != "" {
			accessToken = token
		}
		if token, ok := tokenResp["refresh_token"].(string); ok && token != "" {
			refreshToken = token
		}

		// Fetch Dropbox user profile
		profile, err := FetchDBXUserProfile(accessToken)
		if err != nil {
			log.Printf("Failed to fetch DBX user profile: %v", err)
			ServeDBXAuthHTML(w, false)
			return
		}

		err = database.StoreDBXUser(userID, profile.AccountID, accessToken, refreshToken, profile.Name.DisplayName, profile.Email)
		if err != nil {
			log.Printf("Failed to store DBX token: %v", err)
			ServeDBXAuthHTML(w, false)
			return
		}

		ServeDBXAuthHTML(w, true)
	}
}

func FetchDBXUserProfile(accessToken string) (*dropbox.DropboxAccount, error) {
	req, err := http.NewRequest("POST", "https://api.dropboxapi.com/2/users/get_current_account", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch user profile: status %d", resp.StatusCode)
	}

	var profile dropbox.DropboxAccount
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return nil, err
	}

	return &profile, nil
}

func ServeDBXAuthHTML(w http.ResponseWriter, success bool) {
	workDir, _ := os.Getwd()
	staticDir := filepath.Join(workDir, "static")
	htmlPath := filepath.Join(staticDir, "dropbox.html")

	htmlContent, err := os.ReadFile(htmlPath)
	if err != nil {
		http.Error(w, "Failed to read dropbox.html", http.StatusInternalServerError)
		return
	}
	if success == false {
		htmlContent = []byte(strings.Replace(string(htmlContent), "{{ success }}", "false", 1))
	} else {
		htmlContent = []byte(strings.Replace(string(htmlContent), "{{ success }}", "true", 1))
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(htmlContent)
}
