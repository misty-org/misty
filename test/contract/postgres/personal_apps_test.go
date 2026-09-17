package db

import (
	"context"
	"encoding/json"
	. "github.com/kannachi323/misty/server/internal/platform/postgres"
	"strings"
	"testing"
	"time"
)

func TestPersonalAppDoesNotNeedSpaceAndRevokesImmediately(t *testing.T) {
	db := openTestDatabase(t)
	ctx := context.Background()
	user, err := db.CreateUser("Personal", "personal-app@example.invalid", "password123")
	if err != nil {
		t.Fatal(err)
	}
	app, err := db.InstallUserApp(ctx, user.ID, "browser", "1", 1, []string{"storage.read", "storage.write", "notes.read", "browser.inspect"})
	if err != nil {
		t.Fatal(err)
	}
	for _, scope := range app.GrantedScopes {
		if scope == "notes.read" {
			t.Fatal("Space scope granted to personal app")
		}
	}
	token := strings.Repeat("a", 64)
	session, err := db.CreateAppRuntimeSession(ctx, user.ID, "browser", token, "", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if session.SpaceID != "" {
		t.Fatal("personal session has a Space")
	}
	if _, err = db.PutAppPersonalRecord(ctx, *session, "settings", json.RawMessage(`{"theme":"dark"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err = db.CreateAppRuntimeSession(ctx, user.ID, "browser", strings.Repeat("b", 64), "arbitrary-space", time.Minute); err == nil {
		t.Fatal("Space authority accepted")
	}
	if _, err = db.UninstallUserApp(ctx, user.ID, "browser", time.Now()); err != nil {
		t.Fatal(err)
	}
	if current, err := db.AppRuntimeSessionByToken(ctx, token); err != nil || current != nil {
		t.Fatalf("session survived uninstall: %v %v", current, err)
	}
	if _, err = db.PutAppPersonalRecord(ctx, *session, "settings", json.RawMessage(`{}`)); err == nil {
		t.Fatal("stale authority can still write")
	}
	restored, err := db.InstallUserApp(ctx, user.ID, "browser", "1", 1, []string{"storage.read"})
	if err != nil {
		t.Fatal(err)
	}
	if restored.AuthorityGeneration <= app.AuthorityGeneration {
		t.Fatal("generation did not advance")
	}
	if current, _ := db.AppRuntimeSessionByToken(ctx, token); current != nil {
		t.Fatal("reinstall revived token")
	}
}
func TestPersonalAppRecordsIsolateAccounts(t *testing.T) {
	db := openTestDatabase(t)
	ctx := context.Background()
	for i, email := range []string{"first-personal@example.invalid", "second-personal@example.invalid"} {
		u, err := db.CreateUser("Person", email, "password123")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.InstallUserApp(ctx, u.ID, "example", "1", 1, []string{"storage.read", "storage.write"}); err != nil {
			t.Fatal(err)
		}
		session, err := db.CreateAppRuntimeSession(ctx, u.ID, "example", strings.Repeat(string(rune('a'+i)), 64), "", time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			if _, err = db.PutAppPersonalRecord(ctx, *session, "private", json.RawMessage(`{"secret":true}`)); err != nil {
				t.Fatal(err)
			}
		} else {
			rows, err := db.AppPersonalRecords(ctx, *session)
			if err != nil || len(rows) != 0 {
				t.Fatalf("cross-account data: %v %v", rows, err)
			}
		}
	}
}
func TestPersonalAppConsentRequiredBlocksSession(t *testing.T) {
	db := openTestDatabase(t)
	ctx := context.Background()
	u, err := db.CreateUser("Review", "review-personal@example.invalid", "password123")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.InstallUserApp(ctx, u.ID, "example", "1", 1, []string{"storage.read"}); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Conn.Exec(`UPDATE user_app_installations SET consent_required=TRUE WHERE user_id=$1`, u.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.CreateAppRuntimeSession(ctx, u.ID, "example", strings.Repeat("d", 64), "", time.Minute); err == nil {
		t.Fatal("migrated manager consent authorized personal runtime")
	}
}

func TestPersonalAppConnectionsKeepOwnershipAndRuntimeAuthority(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Connection owner", "personal-connections@example.invalid", "password123")
	if err != nil {
		t.Fatal(err)
	}
	other, err := database.CreateUser("Other owner", "other-personal-connections@example.invalid", "password123")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{owner.ID, other.ID} {
		if _, err = database.InstallUserApp(ctx, id, "inbox", "1", 1, []string{"connections.read"}); err != nil {
			t.Fatal(err)
		}
	}
	account, err := database.SaveConnectedAccount(ctx, ConnectedAccount{UserID: owner.ID, Provider: "google", AccountID: "personal", AccountDisplay: "owner@example.invalid", CredentialCiphertext: []byte("sealed"), CredentialNonce: []byte("nonce"), KeyVersion: 1, Capabilities: []string{"mail"}, GrantedScopes: []string{"gmail.readonly"}})
	if err != nil {
		t.Fatal(err)
	}
	session, err := database.CreateAppRuntimeSession(ctx, owner.ID, "inbox", strings.Repeat("f", 64), "", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	appctx := WithAppExecutionAuthority(ctx, *session)
	if rows, err := database.ConnectedAccounts(appctx, owner.ID); err != nil || len(rows) != 1 || rows[0].ID != account.ID {
		t.Fatalf("owner's connection unavailable: %v %v", rows, err)
	}
	if row, err := database.ConnectedAccount(appctx, owner.ID, account.ID); err != nil || row.ID != account.ID {
		t.Fatalf("owner's connection lookup failed: %v %v", row, err)
	}
	if row, err := database.ConnectedAccountByIdentity(appctx, owner.ID, "google", "personal"); err != nil || row.ID != account.ID {
		t.Fatalf("owner's identity lookup failed: %v %v", row, err)
	}
	otherSession, err := database.CreateAppRuntimeSession(ctx, other.ID, "inbox", strings.Repeat("1", 64), "", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	otherCtx := WithAppExecutionAuthority(ctx, *otherSession)
	if rows, err := database.ConnectedAccounts(otherCtx, other.ID); err != nil || len(rows) != 0 {
		t.Fatalf("another person's connection exposed: %v %v", rows, err)
	}
	if _, err := database.ConnectedAccount(otherCtx, other.ID, account.ID); err == nil {
		t.Fatal("cross-account connection lookup succeeded")
	}
	if _, err := database.ConnectedAccountByIdentity(otherCtx, other.ID, "google", "personal"); err == nil {
		t.Fatal("cross-account identity lookup succeeded")
	}
	for name, forbiddenCtx := range map[string]context.Context{"other owner": otherCtx, "legacy Space": WithAppExecutionAuthority(ctx, AppRuntimeSession{UserID: owner.ID, AppID: "inbox", SpaceID: "old-space"})} {
		t.Run(name, func(t *testing.T) {
			if _, err := database.ConnectedAccounts(forbiddenCtx, owner.ID); err == nil {
				t.Fatal("invalid authority listed connections")
			}
			if _, err := database.ConnectedAccount(forbiddenCtx, owner.ID, account.ID); err == nil {
				t.Fatal("invalid authority read connection")
			}
			if _, err := database.ConnectedAccountByIdentity(forbiddenCtx, owner.ID, "google", "personal"); err == nil {
				t.Fatal("invalid authority read identity")
			}
		})
	}
	if err := database.RevokeConnectedAccount(ctx, owner.ID, account.ID); err != nil {
		t.Fatal(err)
	}
	if rows, err := database.ConnectedAccounts(appctx, owner.ID); err != nil || len(rows) != 0 {
		t.Fatalf("revoked connection exposed: %v %v", rows, err)
	}
	if _, err := database.ConnectedAccount(appctx, owner.ID, account.ID); err == nil {
		t.Fatal("revoked connection readable")
	}
	if _, err := database.UninstallUserApp(ctx, owner.ID, "inbox", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ConnectedAccounts(appctx, owner.ID); err == nil {
		t.Fatal("stale app authority listed connections")
	}
	if _, err := database.ConnectedAccount(appctx, owner.ID, account.ID); err == nil {
		t.Fatal("stale app authority read connection")
	}
	if _, err := database.ConnectedAccountByIdentity(appctx, owner.ID, "google", "personal"); err == nil {
		t.Fatal("stale app authority read identity")
	}

}
func TestPersonalAppMigrationBuiltInJournalNeedsNoInstallation(t *testing.T) {
	db := openTestDatabase(t)
	ctx := context.Background()
	owner, err := db.CreateUser("Space owner", "builtin-journal@example.invalid", "password123")
	if err != nil {
		t.Fatal(err)
	}
	space := createTestSpace(t, db, ctx, owner.ID, "Collaboration")
	if _, err := db.CreateSpaceNote(ctx, owner.ID, space.ID, "Always available"); err != nil {
		t.Fatal(err)
	}
	outsider, err := db.CreateUser("Outsider", "outsider-journal@example.invalid", "password123")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.CreateSpaceNote(ctx, outsider.ID, space.ID, "Forbidden"); err == nil {
		t.Fatal("Space membership bypassed")
	}
}

func TestRetiredAppPermissionAndExportTablesAreAbsent(t *testing.T) {
	database := openTestDatabase(t)
	for _, table := range []string{"user_app_connections", "space_app_connections", "app_personal_record_imports"} {
		var absent bool
		if err := database.Conn.QueryRow(`SELECT to_regclass($1) IS NULL`, table).Scan(&absent); err != nil {
			t.Fatal(err)
		}
		if !absent {
			t.Fatalf("retired table %s still exists", table)
		}
	}
}
