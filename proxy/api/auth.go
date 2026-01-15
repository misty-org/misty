package api

import (
	"encoding/json"
	"net/http"

	"github.com/kannachi323/misty/proxy/db"
)

type UserRegisterRequest struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Password string `json:"password"`
	//TODO: add more fields as needed
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

func LoginUser(db *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var user UserLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&user); err != nil {
			http.Error(w, "Invalid login request data", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		err := db.GetUser(user.Email, user.Password)
		if err != nil {
			http.Error(w, "Invalid email or password", http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}