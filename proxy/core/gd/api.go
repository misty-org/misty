package gd

import (
	"fmt"
	"io"
	"net/http"

	"github.com/kannachi323/misty/proxy/db"
)

func ExecAPIRequest(database *db.Database, userID, gdUserID, method, apiURL string, body io.Reader) (*http.Response, error) {
	accessToken, err := GetAccessToken(database, userID, gdUserID)
	if err != nil {
		return nil, fmt.Errorf("token lookup: %w", err)
	}

	req, err := http.NewRequest(method, apiURL, body)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}

	// If 401, try refresh once and retry
	if resp.StatusCode == http.StatusUnauthorized {
		resp.Body.Close()
		newToken, refreshErr := RefreshToken(database, userID, gdUserID)
		if refreshErr != nil || newToken == "" {
			return nil, fmt.Errorf("token expired and refresh failed: %w", refreshErr)
		}
		resp, err = ExecAPIRequest(database, userID, gdUserID, method, apiURL, body)
		if err != nil {
			return nil, err
		}
	}

	return resp, nil
}
