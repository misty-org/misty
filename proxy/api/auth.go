package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/kannachi323/misty/proxy/core/auth"
	"github.com/kannachi323/misty/proxy/db"
)

type UserRegisterRequest struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Password string `json:"password"`
}

type UserLoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}


func RegisterUser(db *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var user UserRegisterRequest
		if err := json.NewDecoder(r.Body).Decode(&user); err != nil {
			http.Error(w, "Invalid user request data", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		err := db.InsertUser(user.Name, user.Email, user.Password)
		if err != nil {
			http.Error(w, "Failed to create user", http.StatusInternalServerError)
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

func LoginUser(db *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req UserLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid login request data", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		user, err := db.GetUser(req.Email, req.Password)
		if err != nil {
			http.Error(w, "Invalid email or password", http.StatusUnauthorized)
			return
		}

		token, err := auth.GenerateToken(user.ID, user.Email)
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
		if err := db.StoreRefreshToken(user.ID, refreshToken, expiresAt); err != nil {
			http.Error(w, "Failed to store refresh token", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(UserLoginResponse{
			ID:           user.ID,
			Name:         user.Name,
			Email:        user.Email,
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

func RefreshToken(db *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req RefreshRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RefreshToken == "" {
			http.Error(w, "Missing refresh_token", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		// Validate the old refresh token
		userID, err := db.ValidateRefreshToken(req.RefreshToken)
		if err != nil {
			log.Printf("Refresh token validation failed: %v", err)
			http.Error(w, "Invalid or expired refresh token", http.StatusUnauthorized)
			return
		}

		// Revoke the old refresh token (rotation)
		if err := db.RevokeRefreshToken(req.RefreshToken); err != nil {
			http.Error(w, "Failed to revoke old token", http.StatusInternalServerError)
			return
		}

		// Get user email for new access token claims
		email, err := db.GetUserEmailByID(userID)
		if err != nil {
			http.Error(w, "User not found", http.StatusInternalServerError)
			return
		}

		// Generate new access token
		newAccessToken, err := auth.GenerateToken(userID, email)
		if err != nil {
			http.Error(w, "Failed to generate access token", http.StatusInternalServerError)
			return
		}

		// Generate new refresh token
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

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(RefreshResponse{
			Token:        newAccessToken,
			RefreshToken: newRefreshToken,
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

		// Blacklist the access token
		auth.BlacklistToken(claims.ID, claims.ExpiresAt.Time)

		// Revoke refresh token if provided in body
		var req LogoutRequest
		if json.NewDecoder(r.Body).Decode(&req) == nil && req.RefreshToken != "" {
			_ = db.RevokeRefreshToken(req.RefreshToken)
		}

		w.WriteHeader(http.StatusOK)
	}
}
