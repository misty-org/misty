package api

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

const (
	TestingDemoScenarioVersion = "product-research-hub@2"
	TestingDemoResetConfirm    = "RESET MISTY DEMO"
	demoResetLockID            = int64(621043)
)

// DemoService exposes destructive management operations only for isolated
// local or staging demo environments. It is never constructed in production.
type DemoService struct {
	database     *db.Database
	store        LibraryObjectStore
	mode         string
	adminToken   string
	databaseName string
}

type DemoConfig struct {
	Mode         string
	AdminToken   string
	Environment  string
	DatabaseName string
	StorageName  string
}

func DemoConfigFromEnv() DemoConfig {
	storageName := strings.TrimSpace(os.Getenv("MISTY_LIBRARY_LOCAL_DIR"))
	if strings.TrimSpace(os.Getenv("MISTY_DEMO_MODE")) == "staging" {
		storageName = strings.TrimSpace(os.Getenv("R2_BUCKET"))
	}
	return DemoConfig{
		Mode:         strings.TrimSpace(os.Getenv("MISTY_DEMO_MODE")),
		AdminToken:   strings.TrimSpace(os.Getenv("MISTY_DEMO_ADMIN_TOKEN")),
		Environment:  strings.TrimSpace(os.Getenv("MISTY_ENVIRONMENT")),
		DatabaseName: strings.TrimSpace(os.Getenv("DB_NAME")),
		StorageName:  storageName,
	}
}

func NewDemoService(database *db.Database, store LibraryObjectStore, config DemoConfig) (*DemoService, error) {
	if config.Mode == "" {
		return nil, nil
	}
	if config.Mode != "local" && config.Mode != "staging" {
		return nil, errors.New("MISTY_DEMO_MODE must be local or staging")
	}
	if strings.EqualFold(config.Environment, "production") {
		return nil, errors.New("demo management cannot run in production")
	}
	if !strings.Contains(strings.ToLower(config.DatabaseName), "demo") {
		return nil, errors.New("demo management requires a database name containing demo")
	}
	if !strings.Contains(strings.ToLower(config.StorageName), "demo") {
		return nil, errors.New("demo management requires a dedicated storage name or path containing demo")
	}
	if len(config.AdminToken) < 32 {
		return nil, errors.New("MISTY_DEMO_ADMIN_TOKEN must contain at least 32 characters")
	}
	if database == nil || store == nil {
		return nil, errors.New("demo management requires a database and Library object store")
	}
	return &DemoService{
		database: database, store: store, mode: config.Mode,
		adminToken: config.AdminToken, databaseName: config.DatabaseName,
	}, nil
}

func (s *DemoService) Status() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.TestingAuthorized(r) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		var schemaVersion int64
		if err := s.database.Conn.QueryRowContext(r.Context(), `SELECT COALESCE(MAX(version_id),0) FROM goose_db_version WHERE is_applied`).Scan(&schemaVersion); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ready": false, "error": "schema version unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ready": true, "mode": s.mode, "scenario_version": TestingDemoScenarioVersion,
			"schema_version": schemaVersion,
		})
	}
}

func (s *DemoService) Reset() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.TestingAuthorized(r) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		var body struct {
			ScenarioVersion string `json:"scenario_version"`
			Confirmation    string `json:"confirmation"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if body.ScenarioVersion != TestingDemoScenarioVersion || body.Confirmation != TestingDemoResetConfirm {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid demo reset confirmation"})
			return
		}
		deletedObjects, accountIDs, err := s.reset(r.Context())
		if errors.Is(err, errDemoResetBusy) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "demo reset failed", "detail": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"scenario_version":        TestingDemoScenarioVersion,
			"deleted_library_objects": deletedObjects,
			"accounts_preserved":      true,
			"account_ids":             accountIDs,
		})
	}
}

func (s *DemoService) AgentMessages() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.TestingAuthorized(r) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		var body struct {
			BillingUserID  string `json:"billing_user_id"`
			SpaceID        string `json:"space_id"`
			ConversationID string `json:"conversation_id"`
			AgentID        string `json:"agent_id"`
			Text           string `json:"text"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		body.Text = strings.TrimSpace(body.Text)
		if body.BillingUserID == "" || body.SpaceID == "" || body.AgentID == "" || body.Text == "" || len([]rune(body.Text)) > 12_000 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid deterministic Agent message"})
			return
		}
		if err := s.requireDemoOwner(r.Context(), body.BillingUserID, body.SpaceID); err != nil {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "demo owner required"})
			return
		}
		var message any
		var err error
		if body.ConversationID == "" {
			message, err = s.database.CreateSpaceAgentMessage(r.Context(), body.BillingUserID, body.SpaceID, body.AgentID, body.Text)
		} else {
			message, err = s.database.CreateSpaceConversationAgentMessage(r.Context(), body.BillingUserID, body.SpaceID, body.ConversationID, body.AgentID, body.Text)
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create deterministic Agent message"})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"message": message})
	}
}

var errDemoResetBusy = errors.New("another demo reset is already running")

func (s *DemoService) reset(ctx context.Context) (int, map[string]string, error) {
	tx, err := s.database.Conn.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return 0, nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	if _, err := tx.ExecContext(ctx, `SELECT set_config('app.rls_mode','service',true)`); err != nil {
		return 0, nil, err
	}
	var locked bool
	if err := tx.QueryRowContext(ctx, `SELECT pg_try_advisory_xact_lock($1)`, demoResetLockID).Scan(&locked); err != nil {
		return 0, nil, err
	}
	if !locked {
		return 0, nil, errDemoResetBusy
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT r2_object_key FROM library_blobs WHERE r2_object_key<>''
		UNION SELECT object_key FROM space_library_uploads WHERE object_key<>''`)
	if err != nil {
		return 0, nil, err
	}
	keys := []string{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return 0, nil, err
		}
		keys = append(keys, key)
	}
	if err := rows.Close(); err != nil {
		return 0, nil, err
	}
	for _, key := range keys {
		if err := s.store.Delete(ctx, key); err != nil {
			return 0, nil, fmt.Errorf("delete Library object %q: %w", key, err)
		}
	}
	// The demo database is dedicated. Truncating these two roots cascades through
	// all Space, Library, Studio, workflow, run, and legacy Agent resources while
	// leaving users, licenses, passwords, credit wallets, and sessions untouched.
	if _, err := tx.ExecContext(ctx, `TRUNCATE TABLE spaces, security_domains RESTART IDENTITY CASCADE`); err != nil {
		return 0, nil, err
	}
	accountIDs := map[string]string{}
	accountRows, err := tx.QueryContext(ctx, `SELECT lower(email),id FROM users WHERE lower(email) IN ('maya@demo.misty.local','jordan@demo.misty.local') ORDER BY lower(email)`)
	if err != nil {
		return 0, nil, err
	}
	for accountRows.Next() {
		var email, id string
		if err := accountRows.Scan(&email, &id); err != nil {
			accountRows.Close()
			return 0, nil, err
		}
		accountIDs[email] = id
	}
	if err := accountRows.Close(); err != nil {
		return 0, nil, err
	}
	if err := tx.Commit(); err != nil {
		return 0, nil, err
	}
	committed = true
	return len(keys), accountIDs, nil
}

func (s *DemoService) requireDemoOwner(ctx context.Context, userID, spaceID string) error {
	tx, err := s.database.Conn.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `SELECT set_config('app.rls_mode','service',true)`); err != nil {
		return err
	}
	var allowed bool
	err = tx.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM spaces s JOIN users u ON u.id=s.owner_user_id
			WHERE s.id=$1 AND s.owner_user_id=$2
		AND s.lifecycle_state='active' AND lower(u.email) LIKE '%@demo.misty.local'
	)`, spaceID, userID).Scan(&allowed)
	if err != nil {
		return err
	}
	if !allowed {
		return errors.New("not a demo owner")
	}
	return nil
}

func (s *DemoService) TestingAuthorized(r *http.Request) bool {
	presented := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if len(presented) != len(s.adminToken) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(presented), []byte(s.adminToken)) == 1
}

func TestingDemoResetRequestBody() json.RawMessage {
	value, _ := json.Marshal(map[string]string{"scenario_version": TestingDemoScenarioVersion, "confirmation": TestingDemoResetConfirm})
	return value
}
