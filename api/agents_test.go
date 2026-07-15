package api

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"strings"
	"testing"

	"github.com/kannachi323/misty/server/db"
)

func TestTrustedDeviceSignatureBindsMethodPathNonceAndBody(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	payload := deviceSignaturePayload("POST", "/api/devices/device_123/jobs/claim", "1700000000", "unique-nonce-1234", []byte(`{"limit":1}`))
	signature := ed25519.Sign(privateKey, []byte(payload))
	if !ed25519.Verify(publicKey, []byte(payload), signature) {
		t.Fatal("valid device signature was rejected")
	}
	tampered := deviceSignaturePayload("POST", "/api/devices/device_123/jobs/claim", "1700000000", "unique-nonce-1234", []byte(`{"limit":2}`))
	if ed25519.Verify(publicKey, []byte(tampered), signature) {
		t.Fatal("tampered device request reused a valid signature")
	}
}

func TestAgentSnapshotIncludesCompletedResult(t *testing.T) {
	view := snapshotJob(db.AgentJob{
		ID:     "job_123",
		Result: json.RawMessage(`{"answer":"Summary ready","citations":[],"creditsUsed":42}`),
	})
	result, ok := view["result"].(map[string]any)
	if !ok {
		t.Fatalf("snapshot result = %#v, want object", view["result"])
	}
	if result["answer"] != "Summary ready" || result["creditsUsed"] != float64(42) {
		t.Fatalf("snapshot result = %#v", result)
	}
}

func TestAgentPayloadRejectsRawLocalPathFields(t *testing.T) {
	valid := json.RawMessage(`{"scopeId":"scope_abcdefgh","assetId":"asset_123","prompt":"summarize the report"}`)
	if containsLocalPath(valid) {
		t.Fatal("opaque payload was incorrectly treated as a local path")
	}
	for _, raw := range []string{`{"path":"/Users/person/private.pdf"}`, `{"localPath":"C:\\Users\\person\\private.pdf"}`, `{"nested":{"source_path":"/tmp/private.pdf"}}`} {
		if !containsLocalPath(json.RawMessage(raw)) {
			t.Fatalf("payload containing a path field was accepted: %s", raw)
		}
	}
}

func TestAgentPayloadAllowsOnlySafeRelativeCitationLocations(t *testing.T) {
	safe := json.RawMessage(`{"answer":"done","citations":[{"scopeId":"scope_abcdefgh","fileName":"report.pdf","relativePath":"reports/2026/report.pdf","label":"Page 2"}]}`)
	if containsLocalPath(safe) {
		t.Fatal("safe relative citation was rejected")
	}
	for _, raw := range []string{
		`{"relativePath":"/Users/person/private.pdf"}`,
		`{"relativePath":"../../private.pdf"}`,
		`{"relativePath":"C:\\Users\\person\\private.pdf"}`,
	} {
		if !containsLocalPath(json.RawMessage(raw)) {
			t.Fatalf("unsafe citation location was accepted: %s", raw)
		}
	}
}

func TestApprovalActionIsTypedAndPathSafe(t *testing.T) {
	valid := json.RawMessage(`{"kind":"move","summary":"Move the generated summary","scopeId":"scope_abcdefgh","relativePaths":["inbox/summary.md"],"destinationRelativePath":"archive/summary.md"}`)
	if !validApprovalAction(valid) {
		t.Fatal("valid typed approval action was rejected")
	}
	for _, raw := range []string{
		`{"kind":"delete","summary":"Delete it","scopeId":"scope_abcdefgh","relativePaths":["../../private.pdf"]}`,
		`{"kind":"unknown","summary":"Do something","scopeId":"scope_abcdefgh","relativePaths":[]}`,
		`{"kind":"move","summary":"Move it","scopeId":"scope_abcdefgh","relativePaths":["report.pdf"],"destinationRelativePath":"/tmp/report.pdf"}`,
		`{"kind":"overwrite","summary":"Replace it","scopeId":"scope_abcdefgh","relativePaths":["report.md"]}`,
		`{"kind":"change_permissions","summary":"Change it","scopeId":"scope_abcdefgh","relativePaths":["report.md"]}`,
	} {
		if validApprovalAction(json.RawMessage(raw)) {
			t.Fatalf("unsafe approval action was accepted: %s", raw)
		}
	}
}

func TestAgentDefinitionRequiresReviewBeforeEnable(t *testing.T) {
	body := agentDefinitionRequest{DeviceID: "device_12345678-1234-1234-1234-123456789abc", ScopeID: "scope_abcdefgh", Name: "Invoices", Instructions: "Summarize new invoices", Workflow: json.RawMessage(`{"version":1,"revision":1,"nodes":[{"id":"manual","kind":"manual_trigger","config":{},"policy":[]}],"edges":[]}`), WorkflowRevision: 1, TrustPolicy: json.RawMessage(`{"automaticActions":["read"],"approvalRequiredActions":["overwrite","rename","move","delete","change_permissions","outbound_webhook","external_message"],"memberWriteAccess":false,"approvalTtlHours":24}`), Enabled: true}
	if body.valid(true) {
		t.Fatal("new agent was allowed to bypass disabled draft state")
	}
	body.Enabled = false
	if !body.valid(true) {
		t.Fatal("valid disabled agent draft was rejected")
	}
}

func TestTrustedDeviceRegistrationIsStrict(t *testing.T) {
	key := strings.Repeat("a", 43)
	if !validDeviceRegistration("My Mac", key, "ed25519", json.RawMessage(`{"documentExtraction":true}`)) {
		t.Fatal("valid trusted device registration was rejected")
	}
	if validDeviceRegistration("My Mac", key, "rsa", json.RawMessage(`{}`)) {
		t.Fatal("unsupported device key algorithm was accepted")
	}
	if validDeviceRegistration("My Mac", key, "ed25519", json.RawMessage(`{"libraryPath":"/Users/me"}`)) {
		t.Fatal("device capabilities leaked a local path")
	}
}

func TestMembersCannotIncludeOwnerOrDuplicates(t *testing.T) {
	if !hasInvalidUserIDs("owner", []string{"member", "member"}) {
		t.Fatal("duplicate member was accepted")
	}
	if !hasInvalidUserIDs("owner", []string{"owner"}) {
		t.Fatal("owner was accepted as a member row")
	}
	if hasInvalidUserIDs("owner", []string{"member-a", "member-b"}) {
		t.Fatal("valid distinct members were rejected")
	}
}
