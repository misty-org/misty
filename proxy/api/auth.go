package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"log"

	auth "github.com/kannachi323/misty/proxy/core/tokens"
	dbpkg "github.com/kannachi323/misty/proxy/db"
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

func RegisterUser(db *dbpkg.Database, serverURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req UserRegisterRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request data", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		if serverURL == "" {
			http.Error(w, "Server unavailable", http.StatusServiceUnavailable)
			return
		}

		body, _ := json.Marshal(map[string]string{
			"name": req.Name, "email": req.Email, "password": req.Password,
		})
		resp, err := http.Post(serverURL+"/api/register", "application/json", bytes.NewReader(body))
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

		if err := db.SetCurrentUser(result.UserID, req.Name, req.Email); err != nil {
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
}

func LoginUser(db *dbpkg.Database, serverURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req UserLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid login request data", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		if serverURL == "" {
			http.Error(w, "Server unavailable", http.StatusServiceUnavailable)
			return
		}

		// Verify credentials against the central server
		body, _ := json.Marshal(map[string]string{"email": req.Email, "password": req.Password})
		resp, err := http.Post(serverURL+"/api/login", "application/json", bytes.NewReader(body))
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

		if err := db.SetCurrentUser(serverUser.UserID, serverUser.Name, req.Email); err != nil {
			http.Error(w, "Failed to store user locally", http.StatusInternalServerError)
			return
		}

		userID := serverUser.UserID
		userName := serverUser.Name

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

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(UserLoginResponse{
			ID:           userID,
			Name:         userName,
			Email:        req.Email,
			Token:        token,
			RefreshToken: refreshToken,
		})
	}
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type RefreshResponse struct {
	Token        string `json:"token"`
	RefreshToken string `json:"refresh_token"`
}

func RefreshToken(db *dbpkg.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req RefreshRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RefreshToken == "" {
			http.Error(w, "Missing refresh_token", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		userID, err := db.ValidateRefreshToken(req.RefreshToken)
		if err != nil {
			switch {
			case errors.Is(err, dbpkg.ErrTokenNotFound):
				log.Printf("Refresh token validation failed: token not found")
				http.Error(w, "Invalid or expired refresh token", http.StatusUnauthorized)
				return
			case errors.Is(err, dbpkg.ErrTokenExpired):
				log.Printf("Refresh token validation failed: token expired")
				http.Error(w, "Invalid or expired refresh token", http.StatusUnauthorized)
				return
			case errors.Is(err, dbpkg.ErrTokenRevoked):
				log.Printf("Refresh token validation failed: token revoked")
				http.Error(w, "Invalid or expired refresh token", http.StatusUnauthorized)
				return
			default:
				log.Printf("Refresh token validation failed: %v", err)
				http.Error(w, "Failed to validate refresh token", http.StatusInternalServerError)
				return
			}
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

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(RefreshResponse{
			Token:        newAccessToken,
			RefreshToken: req.RefreshToken,
		})
	}
}

type LogoutRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func LogoutUser(db *dbpkg.Database) http.HandlerFunc {
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

		if err := db.RevokeAccessToken(claims.ID, claims.UserID, claims.ExpiresAt.Time); err != nil {
			http.Error(w, "Failed to revoke access token", http.StatusInternalServerError)
			return
		}

		var req LogoutRequest
		if json.NewDecoder(r.Body).Decode(&req) == nil && req.RefreshToken != "" {
			_ = db.RevokeRefreshToken(req.RefreshToken)
		}

		w.WriteHeader(http.StatusOK)
	}
}
