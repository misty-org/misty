package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
	"github.com/kannachi323/misty/server/internal/platform/security"
	"github.com/kannachi323/misty/server/test/testkit"
)

func TestA2AEndpointPostgres(t *testing.T) {
	if os.Getenv("TEST_DB_NAME") != "misty_agent_members_test" {
		t.Skip("requires isolated agent members test database")
	}
	database := testkit.OpenDatabase(t)
	ctx := t.Context()
	alice, _ := database.CreateUser("Alice", "a2a-alice@example.test", "password123")
	bob, _ := database.CreateUser("Bob", "a2a-bob@example.test", "password123")
	outsider, _ := database.CreateUser("Outsider", "a2a-outsider@example.test", "password123")
	space, err := database.TestingCreateSpace(ctx, alice.ID, "Launch team")
	if err != nil {
		t.Fatal(err)
	}
	if err := database.TestingSpaceTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,'member')`, space.ID, bob.ID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	researcher, _ := database.SavePersonalAgent(ctx, bob.ID, "", db.AgentProfileInput{Name: "Researcher", Enabled: true})
	if _, err := database.SaveSpaceAgentListing(ctx, bob.ID, space.ID, researcher.ID, db.SpaceAgentListingInput{Description: "Answers research questions"}); err != nil {
		t.Fatal(err)
	}
	service := &SpacesService{database: database}
	router := chi.NewRouter()
	router.Post("/a2a/spaces/{spaceID}/agents/{agentID}", service.A2AAgent())
	router.Get("/a2a/spaces/{spaceID}/agents/{agentID}/.well-known/agent-card.json", service.A2AAgentCard())
	signer, err := security.SessionSignerFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	path := "/a2a/spaces/" + space.ID + "/agents/" + researcher.ID
	send := func(user, method string, params any) map[string]any {
		t.Helper()
		token, _ := signer.Mint(user, "a2a-session", "access", time.Now().Add(time.Hour))
		raw, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
		r := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
		r.AddCookie(&http.Cookie{Name: TestingSessionCookieName, Value: token})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		var out map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("%s: %d %s", method, w.Code, w.Body.String())
		}
		return out
	}
	taskState := func(response map[string]any) (string, string) {
		t.Helper()
		result, ok := response["result"].(map[string]any)
		if !ok {
			t.Fatalf("no task in %v", response)
		}
		return result["id"].(string), result["status"].(map[string]any)["state"].(string)
	}
	message := map[string]any{"message": map[string]any{"role": "user", "kind": "message", "messageId": "m-1",
		"parts": []map[string]any{{"kind": "text", "text": "What is the launch date?"}}}}

	id, state := taskState(send(alice.ID, "message/send", message))
	if state != "auth-required" {
		t.Fatalf("new request state = %s, want auth-required while Bob decides", state)
	}
	if replay, _ := taskState(send(alice.ID, "message/send", message)); replay != id {
		t.Fatalf("repeated messageId created a second task: %s vs %s", replay, id)
	}
	if _, err := database.DecideAgentMemberRequest(ctx, bob.ID, id, true); err != nil {
		t.Fatal(err)
	}
	if _, state := taskState(send(alice.ID, "tasks/get", map[string]any{"id": id})); state != "submitted" {
		t.Fatalf("approved request state = %s", state)
	}
	if _, state := taskState(send(alice.ID, "tasks/cancel", map[string]any{"id": id})); state != "canceled" {
		t.Fatalf("canceled request state = %s", state)
	}
	if response := send(alice.ID, "tasks/cancel", map[string]any{"id": id}); response["error"].(map[string]any)["code"].(float64) != -32002 {
		t.Fatalf("canceling twice = %v", response)
	}
	if response := send(alice.ID, "tasks/resubscribe", map[string]any{"id": id}); response["error"].(map[string]any)["code"].(float64) != -32601 {
		t.Fatalf("unsupported method = %v", response)
	}
	if response := send(outsider.ID, "message/send", message); response["error"] == nil {
		t.Fatalf("a non-member reached the agent: %v", response)
	}

	token, _ := signer.Mint(alice.ID, "a2a-session", "access", time.Now().Add(time.Hour))
	r := httptest.NewRequest(http.MethodGet, path+"/.well-known/agent-card.json", nil)
	r.AddCookie(&http.Cookie{Name: TestingSessionCookieName, Value: token})
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	var card map[string]any
	if json.Unmarshal(w.Body.Bytes(), &card) != nil || card["name"] != "Researcher" || card["preferredTransport"] != "JSONRPC" {
		t.Fatalf("agent card = %d %s", w.Code, w.Body.String())
	}
}
