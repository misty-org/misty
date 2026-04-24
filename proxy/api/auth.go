package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/kannachi323/misty/proxy/core/auth"
	"github.com/kannachi323/misty/proxy/core/license"
	"github.com/kannachi323/misty/proxy/db"
)

type UserRegisterRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type UserLoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func serverURL() (string, error) {
	u := os.Getenv("MISTY_SERVER_URL")
	if u == "" {
		return "", fmt.Errorf("MISTY_SERVER_URL not configured")
	}
	return u, nil
}

func RegisterUser(db *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req UserRegisterRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request data", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		base, err := serverURL()
		if err != nil {
			http.Error(w, "Server unavailable", http.StatusServiceUnavailable)
			return
		}

		body, _ := json.Marshal(map[string]string{
			"name": req.Name, "email": req.Email, "password": req.Password,
		})
		resp, err := http.Post(base+"/api/register", "application/json", bytes.NewReader(body))
		if err != nil {
			http.Error(w, "Server unreachable", http.StatusServiceUnavailable)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusConflict {
			http.Error(w, "Email already registered", http.StatusConflict)
			return
		}
		if resp.StatusCode != http.StatusCreated {
			http.Error(w, "Registration failed", http.StatusInternalServerError)
			return
		}

		var result struct {
			UserID string `json:"user_id"`
		}
		json.NewDecoder(resp.Body).Decode(&result)

		if err := db.InsertOrIgnoreUser(result.UserID, req.Name, req.Email); err != nil {
			http.Error(w, "Failed to store user locally", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
	}
}

type UserLoginResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	Token        string `json:"token"`
	RefreshToken string `json:"refresh_token"`
	LicenseToken string `json:"license_token"`
}

func LoginUser(db *db.Database, lm *license.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req UserLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid login request data", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		base, err := serverURL()
		if err != nil {
			http.Error(w, "Server unavailable", http.StatusServiceUnavailable)
			return
		}

		// Verify credentials against the central server
		body, _ := json.Marshal(map[string]string{"email": req.Email, "password": req.Password})
		resp, err := http.Post(base+"/api/login", "application/json", bytes.NewReader(body))
		if err != nil {
			http.Error(w, "Server unreachable", http.StatusServiceUnavailable)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusUnauthorized {
			http.Error(w, "Invalid email or password", http.StatusUnauthorized)
			return
		}
		if resp.StatusCode != http.StatusOK {
			http.Error(w, "Authentication failed", http.StatusInternalServerError)
			return
		}

		var serverUser struct {
			UserID string `json:"user_id"`
			Name   string `json:"name"`
			Email  string `json:"email"`
		}
		json.NewDecoder(resp.Body).Decode(&serverUser)

		// Look up existing local record by email to preserve cloud token associations
		localUser, err := db.GetUserByEmail(req.Email)
		if err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}

		var userID, userName string
		if localUser != nil {
			userID = localUser.ID
			userName = localUser.Name
		} else {
			if err := db.InsertOrIgnoreUser(serverUser.UserID, serverUser.Name, req.Email); err != nil {
				http.Error(w, "Failed to store user locally", http.StatusInternalServerError)
				return
			}
			userID = serverUser.UserID
			userName = serverUser.Name
		}

		token, err := auth.GenerateToken(userID, req.Email)
		if err != nil {
			http.Error(w, "Failed to generate token", http.StatusInternalServerError)
			return
		}

		refreshToken, err := auth.GenerateRefreshToken()
		if err != nil {
			http.Error(w, "Failed to generate refresh token", http.StatusInternalServerError)
			return
		}

		expiresAt := time.Now().Add(auth.RefreshTokenExpiry)
		if err := db.StoreRefreshToken(userID, refreshToken, expiresAt); err != nil {
			http.Error(w, "Failed to store refresh token", http.StatusInternalServerError)
			return
		}

		// Entitlement verification is one-time for perpetual pro access.
		// Login still succeeds if the licensing server is unreachable.
		licenseToken, err := lm.RefreshIfNeeded(req.Email, req.Password)
		if err != nil {
			log.Printf("Entitlement verification failed: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(UserLoginResponse{
			ID:           userID,
			Name:         userName,
			Email:        req.Email,
			Token:        token,
			RefreshToken: refreshToken,
			LicenseToken: licenseToken,
		})
	}
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type RefreshResponse struct {
	Token        string `json:"token"`
	RefreshToken string `json:"refresh_token"`
	LicenseToken string `json:"license_token"`
}

func RefreshToken(db *db.Database, lm *license.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req RefreshRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RefreshToken == "" {
			http.Error(w, "Missing refresh_token", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		userID, err := db.ValidateRefreshToken(req.RefreshToken)
		if err != nil {
			log.Printf("Refresh token validation failed: %v", err)
			http.Error(w, "Invalid or expired refresh token", http.StatusUnauthorized)
			return
		}

		if err := db.RevokeRefreshToken(req.RefreshToken); err != nil {
			http.Error(w, "Failed to revoke old token", http.StatusInternalServerError)
			return
		}

		email, err := db.GetUserEmailByID(userID)
		if err != nil {
			http.Error(w, "User not found", http.StatusInternalServerError)
			return
		}

		newAccessToken, err := auth.GenerateToken(userID, email)
		if err != nil {
			http.Error(w, "Failed to generate access token", http.StatusInternalServerError)
			return
		}

		newRefreshToken, err := auth.GenerateRefreshToken()
		if err != nil {
			http.Error(w, "Failed to generate refresh token", http.StatusInternalServerError)
			return
		}

		expiresAt := time.Now().Add(auth.RefreshTokenExpiry)
		if err := db.StoreRefreshToken(userID, newRefreshToken, expiresAt); err != nil {
			http.Error(w, "Failed to store refresh token", http.StatusInternalServerError)
			return
		}

		licenseToken := lm.GetCachedTokenForIdentity(userID, email)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(RefreshResponse{
			Token:        newAccessToken,
			RefreshToken: newRefreshToken,
			LicenseToken: licenseToken,
		})
	}
}

type LogoutRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func LogoutUser(db *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if header == "" || !strings.HasPrefix(header, "Bearer ") {
			http.Error(w, "Missing or invalid Authorization header", http.StatusBadRequest)
			return
		}

		tokenString := strings.TrimPrefix(header, "Bearer ")
		claims, err := auth.ValidateToken(tokenString)
		if err != nil {
			http.Error(w, "Invalid token", http.StatusBadRequest)
			return
		}

		auth.BlacklistToken(claims.ID, claims.ExpiresAt.Time)

		var req LogoutRequest
		if json.NewDecoder(r.Body).Decode(&req) == nil && req.RefreshToken != "" {
			_ = db.RevokeRefreshToken(req.RefreshToken)
		}

		w.WriteHeader(http.StatusOK)
	}
}
