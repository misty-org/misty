package integration

import (
	"net/http"
	"testing"

	"github.com/kannachi323/misty/server/api"
	"github.com/kannachi323/misty/server/billing"
	"github.com/kannachi323/misty/server/db"
	"github.com/kannachi323/misty/server/security"
)

func TestPersonalTrialLifecycle(t *testing.T) {
	database := openIntegrationDatabase(t)

	user, err := database.CreateUser("Trial User", "trial@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	sessionToken := "trial-session"
	if err := database.CreateSession(security.HashToken(sessionToken), user.ID); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}

	cookie := &http.Cookie{Name: sessionCookieName, Value: sessionToken}

	firstRec := performJSONRequest(t, api.StartPersonalTrial(database), http.MethodPost, "/billing/trial/start", nil, cookie)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("first trial start status = %d, want %d, body = %q", firstRec.Code, http.StatusOK, firstRec.Body.String())
	}

	license, err := database.GetLicenseByUserID(user.ID)
	if err != nil || license == nil {
		t.Fatalf("GetLicenseByUserID() error = %v, license = %#v", err, license)
	}
	if license.Tier != db.TierPersonal || license.Status != db.LicenseStatusTrialing || license.ExpiresAt == nil {
		t.Fatalf("trial license = %#v, want personal trialing with expiry", license)
	}

	secondRec := performJSONRequest(t, api.StartPersonalTrial(database), http.MethodPost, "/billing/trial/start", nil, cookie)
	if secondRec.Code != http.StatusConflict {
		t.Fatalf("second trial start status = %d, want %d", secondRec.Code, http.StatusConflict)
	}

	if err := database.UpsertStripePurchase(&db.StripePurchase{
		UserID:                  user.ID,
		LicenseID:               user.LicenseID,
		TierPurchased:           db.TierPersonal,
		StripeCheckoutSessionID: "cs_completed",
		Status:                  "completed",
		EventSource:             "test",
	}); err != nil {
		t.Fatalf("UpsertStripePurchase() error = %v", err)
	}
	if err := database.SetLicenseStateByID(user.LicenseID, db.TierBasic, db.LicenseStatusActive, nil); err != nil {
		t.Fatalf("SetLicenseStateByID() error = %v", err)
	}

	blockedRec := performJSONRequest(t, api.StartPersonalTrial(database), http.MethodPost, "/billing/trial/start", nil, cookie)
	if blockedRec.Code != http.StatusConflict {
		t.Fatalf("purchase-blocked trial status = %d, want %d", blockedRec.Code, http.StatusConflict)
	}
}

func TestWaitlistFlowAndDuplicateNotificationBehavior(t *testing.T) {
	database := openIntegrationDatabase(t)
	sender := &fakeWaitlistSender{}

	service, err := api.NewWaitlistService(database, sender, "notify@example.com")
	if err != nil {
		t.Fatalf("NewWaitlistService() error = %v", err)
	}

	firstRec := performJSONRequest(t, service.Join(), http.MethodPost, "/waitlist", map[string]string{
		"name":  "Ada",
		"email": "ada@example.com",
	})
	if firstRec.Code != http.StatusAccepted {
		t.Fatalf("first waitlist join status = %d, want %d, body = %q", firstRec.Code, http.StatusAccepted, firstRec.Body.String())
	}
	if countWaitlistSignups(t, database) != 1 {
		t.Fatalf("waitlist signups = %d, want 1", countWaitlistSignups(t, database))
	}
	if len(sender.confirmationCalls) != 1 || len(sender.notificationCalls) != 1 {
		t.Fatalf("sender calls = confirmations:%d notifications:%d, want 1 each", len(sender.confirmationCalls), len(sender.notificationCalls))
	}

	secondRec := performJSONRequest(t, service.Join(), http.MethodPost, "/waitlist", map[string]string{
		"name":  "Ada Again",
		"email": "ada@example.com",
	})
	if secondRec.Code != http.StatusAccepted {
		t.Fatalf("second waitlist join status = %d, want %d", secondRec.Code, http.StatusAccepted)
	}
	if countWaitlistSignups(t, database) != 1 {
		t.Fatalf("waitlist signups after duplicate = %d, want 1", countWaitlistSignups(t, database))
	}
	if len(sender.confirmationCalls) != 2 || len(sender.notificationCalls) != 1 {
		t.Fatalf("sender calls after duplicate = confirmations:%d notifications:%d, want 2 and 1", len(sender.confirmationCalls), len(sender.notificationCalls))
	}
}

func TestWaitlistValidationAndFailurePaths(t *testing.T) {
	database := openIntegrationDatabase(t)

	if _, err := api.NewWaitlistService(nil, &fakeWaitlistSender{}, "notify@example.com"); err == nil {
		t.Fatal("NewWaitlistService() succeeded with nil database")
	}
	if _, err := api.NewWaitlistService(database, nil, "notify@example.com"); err == nil {
		t.Fatal("NewWaitlistService() succeeded with nil sender")
	}

	sender := &fakeWaitlistSender{confirmationErr: errTestFailure}
	service, err := api.NewWaitlistService(database, sender, "notify@example.com")
	if err != nil {
		t.Fatalf("NewWaitlistService() error = %v", err)
	}

	if rec := performJSONRequest(t, service.Join(), http.MethodPost, "/waitlist", map[string]string{"name": "Ada"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("missing email status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if rec := performJSONRequest(t, service.Join(), http.MethodPost, "/waitlist", map[string]string{"email": "invalid"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid email status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if rec := performJSONRequest(t, service.Join(), http.MethodPost, "/waitlist", map[string]string{"name": "Ada", "email": "ada@example.com"}); rec.Code != http.StatusBadGateway {
		t.Fatalf("confirmation failure status = %d, want %d", rec.Code, http.StatusBadGateway)
	}
}

var errTestFailure = billing.ErrInvalidTier
