package api

import (
	"errors"
	"net/http"

	appbilling "github.com/kannachi323/misty/server/billing"
	"github.com/kannachi323/misty/server/db"
)

func CreateCheckoutSession(database *db.Database) http.HandlerFunc {
	service := appbilling.NewService(database)

	return func(w http.ResponseWriter, r *http.Request) {
		userID, err := sessionUserID(r, database)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if userID == "" {
			http.Error(w, "not authenticated", http.StatusUnauthorized)
			return
		}

		var body struct {
			Tier db.Tier `json:"tier"`
		}
		if err := decodeJSON(w, r, &body); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		url, err := service.CreateCheckoutSession(userID, body.Tier)
		switch {
		case errors.Is(err, appbilling.ErrInvalidTier):
			http.Error(w, "invalid tier", http.StatusBadRequest)
			return
		case errors.Is(err, appbilling.ErrUserNotFound):
			http.Error(w, "user not found", http.StatusNotFound)
			return
		case err != nil:
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"url": url})
	}
}

func StartPersonalTrial(database *db.Database) http.HandlerFunc {
	service := appbilling.NewService(database)

	return func(w http.ResponseWriter, r *http.Request) {
		userID, err := sessionUserID(r, database)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if userID == "" {
			http.Error(w, "not authenticated", http.StatusUnauthorized)
			return
		}

		updatedLicense, err := service.StartPersonalTrial(userID)
		switch {
		case errors.Is(err, appbilling.ErrLicenseNotFound):
			http.Error(w, "license not found", http.StatusInternalServerError)
			return
		case errors.Is(err, appbilling.ErrTrialUnavailable):
			http.Error(w, "trial unavailable", http.StatusConflict)
			return
		case err != nil:
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"tier":       string(updatedLicense.Tier),
			"status":     updatedLicense.Status,
			"expires_at": updatedLicense.ExpiresAt,
		})
	}
}
