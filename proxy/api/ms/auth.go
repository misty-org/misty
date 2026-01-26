package ms

import (
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/kannachi323/misty/proxy/core/ms"
)

type OAuthLoginResponse struct {
	AuthURL string `json:"auth_url"`
}

func GetOAuthLogin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		config := ms.GetConfig()
		if config == nil {
			http.Error(w, "Failed to get MS config", http.StatusInternalServerError)
			return
		}

		authURL := "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?" + url.Values{
			"client_id":     {config.ClientID},
			"redirect_uri":  {config.RedirectURI},
			"response_type": {"code"},
			"scope":         {config.GetScopesString()},
			"prompt":        {"consent"},
		}.Encode()

		response := OAuthLoginResponse{AuthURL: authURL}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}
}

func OAuthCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		config := ms.GetConfig()
		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "Code parameter is required", http.StatusBadRequest)
			return
		}

		resp, err := http.PostForm("https://login.microsoftonline.com/common/oauth2/v2.0/token", url.Values{
			"client_id":     {config.ClientID},
			"client_secret": {config.ClientSecret},
			"code":          {code},
			"redirect_uri":  {config.RedirectURI},
			"grant_type":    {"authorization_code"},
			"scope":         {"https://graph.microsoft.com/User.Read offline_access"},
		})
		if err != nil {
			http.Error(w, "Token request failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer resp.Body.Close()

		var tokenResp map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&tokenResp)

		if errMsg, ok := tokenResp["error"]; ok {
			http.Error(w, "Token error: "+errMsg.(string)+": "+tokenResp["error_description"].(string), http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(tokenResp)
	}
}