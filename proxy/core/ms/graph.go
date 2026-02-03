package ms

import (
	"fmt"
	"io"
	"net/http"

	"github.com/kannachi323/misty/proxy/db"
)

func ExecGraphRequest(database *db.Database, userID, msUserID, method, graphURL string, body io.Reader) (*http.Response, error) {
	accessToken, err := GetAccessToken(database, userID, msUserID)
	if err != nil {
		return nil, fmt.Errorf("token lookup: %w", err)
	}

	req, err := http.NewRequest(method, graphURL, body)
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
		newToken, refreshErr := RefreshToken(database, userID, msUserID)
		if refreshErr != nil || newToken == "" {
			return nil, fmt.Errorf("token expired and refresh failed: %w", refreshErr)
		}
		resp, err = ExecGraphRequest(database, userID, msUserID, method, graphURL, body)
		if err != nil {
			return nil, err
		}
	}

	

	return resp, nil
}