package gd

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

	"github.com/kannachi323/misty/proxy/core/gd"
	"github.com/kannachi323/misty/proxy/core/utils"
	"github.com/kannachi323/misty/proxy/db"
)

func GetOAuthLogin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		config := gd.GetConfig()
		if config == nil {
			http.Error(w, "Google Drive config not found", http.StatusInternalServerError)
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
			Path:     "/api/gd/callback",
			MaxAge:   300,
			HttpOnly: true,
			Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
			SameSite: http.SameSiteLaxMode,
		})

		state := gd.OAuthState{UserID: userID, CSRFToken: csrfToken}
		stateJSON, _ := json.Marshal(state)
		stateEncoded := base64.URLEncoding.EncodeToString(stateJSON)

		params := url.Values{
			"client_id":              {config.ClientID},
			"redirect_uri":           {config.RedirectURI},
			"response_type":          {"code"},
			"scope":                  {config.GetScopesString()},
			"prompt":                 {"consent"},
			"state":                  {stateEncoded},
			"access_type":            {"offline"},
			"include_granted_scopes": {"true"},
		}

		log.Println(params.Get("client_id"))

		authURL := fmt.Sprintf("https://accounts.google.com/o/oauth2/v2/auth?%s", params.Encode())

		http.Redirect(w, r, authURL, http.StatusFound)
		
	}
}

func OAuthCallback(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		config := gd.GetConfig()
		code := r.URL.Query().Get("code")
		stateParam := r.URL.Query().Get("state")

		// Decode state parameter to get user_id and CSRF token
		var state gd.OAuthState
		if stateParam != "" {
			decoded, err := base64.URLEncoding.DecodeString(stateParam)
			if err == nil {
				json.Unmarshal(decoded, &state)
			}
		}

		if code == "" || state.UserID == "" {
			log.Printf("code or user_id is empty - code: %s, userID: %s", code, state.UserID)
			ServeGDAuthHTML(w, false)
			return
		}

		// Validate CSRF token from cookie
		csrfCookie, err := r.Cookie(utils.CSRFCookieName)
		if err != nil || csrfCookie.Value == "" {
			log.Printf("CSRF cookie missing or empty")
			ServeGDAuthHTML(w, false)
			return
		}

		// Constant-time comparison to prevent timing attacks
		if subtle.ConstantTimeCompare([]byte(csrfCookie.Value), []byte(state.CSRFToken)) != 1 {
			log.Printf("CSRF token mismatch")
			ServeGDAuthHTML(w, false)
			return
		}

		// Clear the CSRF cookie
		http.SetCookie(w, &http.Cookie{
			Name:     utils.CSRFCookieName,
			Value:    "",
			Path:     "/api/gd/callback",
			MaxAge:   -1,
			HttpOnly: true,
		})

		userID := state.UserID
		tokenURL := "https://oauth2.googleapis.com/token"

		resp, err := http.PostForm(tokenURL, url.Values{
			"client_id":     {config.ClientID},
			"client_secret": {config.ClientSecret},
			"code":          {code},
			"redirect_uri":  {config.RedirectURI},
			"grant_type":    {"authorization_code"},
		})
		if err != nil {
			log.Printf("Failed to exchange code for token: %v", err)
			ServeGDAuthHTML(w, false)
			return
		}
		defer resp.Body.Close()

		var tokenResp map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
			log.Printf("Failed to decode token response: %v", err)
			ServeGDAuthHTML(w, false)
			return
		}
		if _, ok := tokenResp["error"]; ok {
			log.Printf("Token exchange error: %v", tokenResp["error"])
			ServeGDAuthHTML(w, false)
			return
		}

		var refreshToken, accessToken string
		if token, ok := tokenResp["access_token"].(string); ok && token != "" {
			accessToken = token
		}
		if token, ok := tokenResp["refresh_token"].(string); ok && token != "" {
			refreshToken = token
		}

		// Fetch Google user profile
		profile, err := FetchGDUserProfile(accessToken)
		if err != nil {
			log.Printf("Failed to fetch GD user profile: %v", err)
			ServeGDAuthHTML(w, false)
			return
		}

		err = database.StoreGDUser(userID, profile.ID, accessToken, refreshToken, profile.Name, profile.Email)
		if err != nil {
			log.Printf("Failed to store GD token: %v", err)
			ServeGDAuthHTML(w, false)
			return
		}

		ServeGDAuthHTML(w, true)
	}
}


func FetchGDUserProfile(accessToken string) (*gd.GoogleUserProfile, error) {
	req, err := http.NewRequest("GET", "https://www.googleapis.com/oauth2/v2/userinfo", nil)
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

	var profile gd.GoogleUserProfile
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return nil, err
	}

	return &profile, nil
}

func ServeGDAuthHTML(w http.ResponseWriter, success bool) {
	// Read the redirect.html file
	workDir, _ := os.Getwd()
	staticDir := filepath.Join(workDir, "static")
	htmlPath := filepath.Join(staticDir, "gdrive.html")

	htmlContent, err := os.ReadFile(htmlPath)
	if err != nil {
		http.Error(w, "Failed to read redirect.html", http.StatusInternalServerError)
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