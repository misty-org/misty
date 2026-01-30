package ms

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

	"github.com/kannachi323/misty/proxy/core/ms"
	"github.com/kannachi323/misty/proxy/core/utils"
	"github.com/kannachi323/misty/proxy/db"
)



func GetOAuthLogin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		config := ms.GetConfig()
		if config == nil {
			http.Error(w, "Failed to get MS config", http.StatusInternalServerError)
			return
		}

		userID := r.URL.Query().Get("user_id")
		if userID == "" {
			http.Error(w, "user_id parameter is required", http.StatusBadRequest)
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
			Path:     "/api/ms/callback",
			MaxAge:   600, // 10 minutes
			HttpOnly: true,
			Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
			SameSite: http.SameSiteLaxMode,
		})

		state := ms.OAuthState{UserID: userID, CSRFToken: csrfToken}
		stateJSON, _ := json.Marshal(state)
		stateEncoded := base64.URLEncoding.EncodeToString(stateJSON)

		params := url.Values{
			"client_id":     {config.ClientID},
			"redirect_uri":  {config.RedirectURI},
			"response_type": {"code"},
			"scope":         {config.GetScopesString()},
			"prompt":        {"login"},
			"state":         {stateEncoded},
		}

		authURL := fmt.Sprintf("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?%s", params.Encode())
		
		http.Redirect(w, r, authURL, http.StatusFound)
	}
}

func OAuthCallback(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		config := ms.GetConfig()
		code := r.URL.Query().Get("code")
		stateParam := r.URL.Query().Get("state")

		// Decode state parameter to get user_id and CSRF token
		var state ms.OAuthState
		if stateParam != "" {
			decoded, err := base64.URLEncoding.DecodeString(stateParam)
			if err == nil {
				json.Unmarshal(decoded, &state)
			}
		}

		if code == "" || state.UserID == "" {
			log.Printf("code or user_id is empty - code: %s, userID: %s", code, state.UserID)
			ServeMSAuthHTML(w, false)
			return
		}

		// Validate CSRF token from cookie
		csrfCookie, err := r.Cookie(utils.CSRFCookieName)
		if err != nil || csrfCookie.Value == "" {
			log.Printf("CSRF cookie missing or empty")
			ServeMSAuthHTML(w, false)
			return
		}

		// Constant-time comparison to prevent timing attacks
		if subtle.ConstantTimeCompare([]byte(csrfCookie.Value), []byte(state.CSRFToken)) != 1 {
			log.Printf("CSRF token mismatch")
			ServeMSAuthHTML(w, false)
			return
		}

		// Clear the CSRF cookie
		http.SetCookie(w, &http.Cookie{
			Name:     utils.CSRFCookieName,
			Value:    "",
			Path:     "/api/ms/callback",
			MaxAge:   -1,
			HttpOnly: true,
		})

		userID := state.UserID
		tokenURL := fmt.Sprintf("https://login.microsoftonline.com/common/oauth2/v2.0/token")

		resp, err := http.PostForm(tokenURL, url.Values{
			"client_id":     {config.ClientID},
			"code":          {code},
			"redirect_uri":  {config.RedirectURI},
			"grant_type":    {"authorization_code"},
			"scope":         {config.GetScopesString()},
		})
		if err != nil {
			ServeMSAuthHTML(w, false)
			return
		}
		defer resp.Body.Close()

		var tokenResp map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
			ServeMSAuthHTML(w, false)
			return
		}
		if _, ok := tokenResp["error"]; ok {
			ServeMSAuthHTML(w, false)
			return
		}

		var refreshToken, accessToken string
		if token, ok := tokenResp["access_token"].(string); ok && token != "" {
			accessToken = token
		}
		if token, ok := tokenResp["refresh_token"].(string); ok && token != "" {
			refreshToken = token
		}

		// Fetch Microsoft user profile and store tokens directly (no redirect with tokens in URL)
		profile, err := FetchMSUserProfile(accessToken)
		if err != nil {
			log.Printf("Failed to fetch MS user profile: %v", err)
			ServeMSAuthHTML(w, false)
			return
		}

		err = database.StoreMSUser(userID, profile.ID, accessToken, refreshToken, profile.DisplayName, profile.Email())
		if err != nil {
			log.Printf("Failed to store MS token: %v", err)
			ServeMSAuthHTML(w, false)
			return
		}

		ServeMSAuthHTML(w, true)
	}
}


func ServeMSAuthHTML(w http.ResponseWriter, success bool) {
	// Read the redirect.html file
	workDir, _ := os.Getwd()
	staticDir := filepath.Join(workDir, "static")
	htmlPath := filepath.Join(staticDir, "redirect.html")

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