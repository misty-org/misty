package utils

import (
	"crypto/rand"
	"encoding/base64"
)

const (
	CSRFCookieName = "ms_oauth_csrf"
	CSRFTokenBytes = 32
)

func GenerateCSRFToken() (string, error) {
	b := make([]byte, CSRFTokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}