package db

import (
	"context"
	"database/sql"
	"errors"
	"github.com/google/uuid"
	"github.com/kannachi323/misty/server/internal/aimodels"
	"github.com/lib/pq"
	"os"
	"strings"
	"testing"
)

func aiProviderTestDB(t *testing.T) *Database {
	t.Helper()
	dsn := os.Getenv("MISTY_AI_PROVIDERS_TEST_DSN")
	if dsn == "" {
		t.Skip("requires disposable misty_ai_provider_settings_test PostgreSQL")
	}
	admin, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	var name string
	if err = admin.QueryRow(`SELECT current_database()`).Scan(&name); err != nil || name != "misty_ai_provider_settings_test" {
		admin.Close()
		t.Fatal("refusing non-disposable provider settings database")
	}
	schema := "providers_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec(`CREATE SCHEMA ` + pq.QuoteIdentifier(schema)); err != nil {
		t.Fatal(err)
	}
	conn, err := sql.Open("postgres", dsn+" search_path="+schema)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		conn.Close()
		admin.Exec(`DROP SCHEMA ` + pq.QuoteIdentifier(schema) + ` CASCADE`)
		admin.Close()
	})
	if _, err = conn.Exec(`CREATE TABLE account_cloud_mutations(transaction_id bigint,user_id text,added_bytes bigint,removed_bytes bigint);
 CREATE TABLE users(id text PRIMARY KEY);INSERT INTO users VALUES('owner'),('other');
 CREATE FUNCTION misty_rls_user_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_user_id',true),'') $$;
 CREATE FUNCTION misty_rls_is_service() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('app.rls_mode',true)='service' $$;`); err != nil {
		t.Fatal(err)
	}
	migration, err := migrationFiles.ReadFile("migrations/20271004030000_ai_provider_settings.sql")
	if err != nil {
		t.Fatal(err)
	}
	up, down, _ := strings.Cut(string(migration), "-- +goose Down")
	for _, part := range []string{up, down, up} {
		if _, err = conn.Exec(part); err != nil {
			t.Fatal(err)
		}
	}
	return &Database{Conn: conn}
}
func TestAIProviderAccountIsolationFrozenRoutesAndRevocation(t *testing.T) {
	database := aiProviderTestDB(t)
	ctx := context.Background()
	c := AIProviderConnection{ID: "personal-key", Name: "Personal OpenAI", Provider: "openai", BaseURL: "https://api.openai.com/v1", Ciphertext: []byte("encrypted-fixture"), Nonce: []byte("fixture-nonce")}
	if err := database.CreateAIProviderConnection(ctx, "owner", c); err != nil {
		t.Fatal(err)
	}
	if _, err := database.AIProviderConnection(ctx, "other", c.ID); !errors.Is(err, ErrSpaceNotFound) {
		t.Fatal("connection leaked across accounts", err)
	}
	if err := database.RotateAIProviderKey(ctx, "other", c.ID, []byte("other"), []byte("nonce")); !errors.Is(err, ErrSpaceNotFound) {
		t.Fatal("another account rotated the key", err)
	}
	routes := []aimodels.Route{}
	for _, role := range aimodels.Roles {
		routes = append(routes, aimodels.Route{Role: role.ID, Enabled: true})
	}
	routes[0].ConnectionID = c.ID
	routes[0].Model = "openai/gpt-6-luna"
	routes[0].Reasoning = "low"
	if err := database.SaveAIModelRoutes(ctx, "other", routes); !errors.Is(err, ErrSpaceNotFound) {
		t.Fatal("cross-account model assignment succeeded", err)
	}
	if err := database.SaveAIModelRoutes(ctx, "owner", routes); err != nil {
		t.Fatal(err)
	}
	defaults := append([]aimodels.Route(nil), routes...)
	for i := range defaults {
		defaults[i].ConnectionID = ""
		defaults[i].Model = "openai/gpt-6-luna"
		defaults[i].Reasoning = "high"
	}
	if _, err := database.FreezeAIModelRoutes(ctx, "owner", "run-1", defaults); err != nil {
		t.Fatal(err)
	}
	routes[0].Model = "openai/gpt-5.6-luna"
	if err := database.SaveAIModelRoutes(ctx, "owner", routes); err != nil {
		t.Fatal(err)
	}
	frozen, err := database.FreezeAIModelRoutes(ctx, "owner", "run-1", defaults)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range frozen {
		if r.Role == "agent" && (r.Model != "openai/gpt-6-luna" || r.Reasoning != "low" || r.ConnectionID != c.ID) {
			t.Fatal("running task changed with account preferences", r)
		}
	}
	if _, err = database.AIModelRunRoute(ctx, "other", "run-1", "agent"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("another account read a run route", err)
	}
	if err = database.RevokeAIProviderConnection(ctx, "owner", c.ID); !errors.Is(err, ErrAIConnectionInUse) {
		t.Fatal("assigned connection was removed", err)
	}
	routes[0].Enabled = false
	if err = database.SaveAIModelRoutes(ctx, "owner", routes); err != nil {
		t.Fatal(err)
	}
	if err = database.RevokeAIProviderConnection(ctx, "owner", c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = database.AIProviderConnection(ctx, "owner", c.ID); !errors.Is(err, ErrSpaceNotFound) {
		t.Fatal("revoked key remains accessible", err)
	}
	if _, err = database.FreezeAIModelRoutes(ctx, "owner", "run-2", defaults); err != nil {
		t.Fatal(err)
	}
	disabled, err := database.AIModelRunRoute(ctx, "owner", "run-2", "agent")
	if err != nil || disabled.Enabled {
		t.Fatal("disabled model route was reenabled", err)
	}
}
