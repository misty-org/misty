package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/kannachi323/misty/server/db"
)

func TestSpaceIntegrationResponsesNeverExposeVaultReferences(t *testing.T) {
	raw, err := json.Marshal(db.SpaceIntegration{Provider: "drive", DisplayName: "Team Drive", CredentialReference: "vault://secret-connection"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "vault") || strings.Contains(string(raw), "credential_reference") {
		t.Fatalf("integration response leaked credential reference: %s", raw)
	}
}

func TestPromptFromRunUsesPinnedInvocationInput(t *testing.T) {
	run := &db.SpaceRun{Input: json.RawMessage(`{"prompt":"approved operation","untrusted":"ignored"}`)}
	if prompt := promptFromRun(run); prompt != "approved operation" {
		t.Fatalf("promptFromRun = %q", prompt)
	}
}
