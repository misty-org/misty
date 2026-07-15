package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/server/db"
)

var (
	deviceIDPattern    = regexp.MustCompile(`^device_[0-9a-f-]{36}$`)
	agentIDPattern     = regexp.MustCompile(`^agent_[0-9a-f-]{36}$`)
	jobIDPattern       = regexp.MustCompile(`^job_[0-9a-f-]{36}$`)
	approvalIDPattern  = regexp.MustCompile(`^approval_[0-9a-f-]{36}$`)
	scopeIDPattern     = regexp.MustCompile(`^scope_[A-Za-z0-9_-]{8,128}$`)
	digestPattern      = regexp.MustCompile(`^[0-9a-f]{64}$`)
	deviceNoncePattern = regexp.MustCompile(`^[A-Za-z0-9+/=_-]{16,200}$`)
)

var triggerKinds = map[string]bool{"manual": true, "schedule": true, "file_created": true, "file_changed": true, "local_webhook": true}
var workflowNodeKinds = map[string]bool{"manual_trigger": true, "schedule_trigger": true, "file_event": true, "local_webhook": true, "document_read": true, "document_ocr": true, "folder_query": true, "mika_task": true, "artifact_create": true, "approval": true, "reply": true}
var agentActionKinds = map[string]bool{"read": true, "search": true, "summarize": true, "notify_local": true, "create_file": true, "overwrite": true, "rename": true, "move": true, "delete": true, "change_permissions": true, "outbound_webhook": true, "external_message": true}

type AgentsService struct{ database *db.Database }

func NewAgentsService(database *db.Database) *AgentsService {
	return &AgentsService{database: database}
}

const (
	deviceSignatureMaxSkew = 5 * time.Minute
	deviceSignedBodyLimit  = 2 << 20
)

// DeviceAuthenticated requires both the account session and possession of the
// registered device private key. A nonce is consumed atomically to reject
// replayed leases and completions across horizontally-scaled servers.
func (s *AgentsService) DeviceAuthenticated(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		deviceID := chi.URLParam(r, "deviceID")
		timestampText := strings.TrimSpace(r.Header.Get("X-Misty-Device-Timestamp"))
		nonce := strings.TrimSpace(r.Header.Get("X-Misty-Device-Nonce"))
		signatureText := strings.TrimSpace(r.Header.Get("X-Misty-Device-Signature"))
		timestamp, err := strconv.ParseInt(timestampText, 10, 64)
		if !deviceIDPattern.MatchString(deviceID) || !deviceNoncePattern.MatchString(nonce) || err != nil || time.Since(time.Unix(timestamp, 0)).Abs() > deviceSignatureMaxSkew {
			http.Error(w, "invalid device authentication", http.StatusUnauthorized)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, deviceSignedBodyLimit))
		if err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		publicKeyText, err := s.database.TrustedDevicePublicKey(userID, deviceID)
		if err != nil {
			if errors.Is(err, db.ErrDeviceNotFound) {
				http.Error(w, "device not found", http.StatusNotFound)
			} else {
				http.Error(w, "invalid device authentication", http.StatusUnauthorized)
			}
			return
		}
		publicKey, keyErr := decodeDeviceBase64(publicKeyText)
		signature, signatureErr := decodeDeviceBase64(signatureText)
		canonical := deviceSignaturePayload(r.Method, r.URL.EscapedPath(), timestampText, nonce, body)
		if keyErr != nil || signatureErr != nil || len(publicKey) != ed25519.PublicKeySize || len(signature) != ed25519.SignatureSize || !ed25519.Verify(ed25519.PublicKey(publicKey), []byte(canonical), signature) {
			http.Error(w, "invalid device authentication", http.StatusUnauthorized)
			return
		}
		nonceExpiresAt := time.Unix(timestamp, 0).Add(deviceSignatureMaxSkew)
		if _, err := s.database.ConsumeTrustedDeviceNonce(userID, deviceID, nonce, nonceExpiresAt); err != nil {
			http.Error(w, "device request already used", http.StatusConflict)
			return
		}
		next(w, r)
	}
}

func deviceSignaturePayload(method, path, timestamp, nonce string, body []byte) string {
	bodyDigest := sha256.Sum256(body)
	return fmt.Sprintf("%s\n%s\n%s\n%s\n%x", strings.ToUpper(method), path, timestamp, nonce, bodyDigest)
}

func (s *AgentsService) RegisterDevice() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		var body struct {
			Name         string          `json:"name"`
			PublicKey    string          `json:"publicKey"`
			KeyAlgorithm string          `json:"keyAlgorithm"`
			Capabilities json.RawMessage `json:"capabilities"`
		}
		if decodeAIJSON(w, r, &body) != nil || !validDeviceRegistration(body.Name, body.PublicKey, body.KeyAlgorithm, body.Capabilities) {
			http.Error(w, "invalid request", 400)
			return
		}
		d, err := s.database.RegisterTrustedDevice(userID, strings.TrimSpace(body.Name), strings.TrimSpace(body.PublicKey), body.Capabilities)
		writeAgentResult(w, d, err, http.StatusCreated)
	}
}
func (s *AgentsService) ListDevices() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		d, e := s.database.TrustedDevices(userID)
		if e != nil {
			http.Error(w, "internal error", 500)
			return
		}
		writeJSON(w, 200, map[string]any{"devices": d})
	}
}
func (s *AgentsService) HeartbeatDevice() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "deviceID")
		var body struct {
			Capabilities json.RawMessage `json:"capabilities"`
		}
		if !deviceIDPattern.MatchString(id) || decodeAIJSON(w, r, &body) != nil || !validJSONObject(body.Capabilities) {
			http.Error(w, "invalid request", 400)
			return
		}
		d, e := s.database.HeartbeatTrustedDevice(userID, id, body.Capabilities)
		writeAgentResult(w, d, e, 200)
	}
}
func (s *AgentsService) RevokeDevice() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "deviceID")
		if !deviceIDPattern.MatchString(id) {
			http.Error(w, "invalid request", 400)
			return
		}
		if e := s.database.RevokeTrustedDevice(userID, id); e != nil {
			writeAgentError(w, e)
			return
		}
		writeJSON(w, 200, map[string]string{"status": "revoked"})
	}
}

type agentDefinitionRequest struct {
	ID                   string          `json:"id"`
	DeviceID             string          `json:"deviceId"`
	ScopeID              string          `json:"scopeId"`
	Name                 string          `json:"name"`
	Instructions         string          `json:"instructions"`
	Workflow             json.RawMessage `json:"workflow"`
	WorkflowRevision     int             `json:"workflowRevision"`
	TrustPolicy          json.RawMessage `json:"trustPolicy"`
	CloudDocumentConsent bool            `json:"cloudDocumentConsent"`
	Enabled              bool            `json:"enabled"`
	Version              int             `json:"version"`
}

func (b agentDefinitionRequest) valid(create bool) bool {
	if !validText(b.Name, 1, 100) || !validText(b.Instructions, 1, 10000) || !validAgentWorkflow(b.Workflow) || !validAgentTrustPolicy(b.TrustPolicy) || b.WorkflowRevision < 1 {
		return false
	}
	if create && (!deviceIDPattern.MatchString(b.DeviceID) || !scopeIDPattern.MatchString(b.ScopeID) || b.Enabled) {
		return false
	}
	if create && b.ID != "" && !agentIDPattern.MatchString(b.ID) {
		return false
	}
	if !create && b.Version < 1 {
		return false
	}
	return !containsLocalPath(b.Workflow) && !containsLocalPath(b.TrustPolicy)
}

func validAgentWorkflow(raw json.RawMessage) bool {
	var workflow struct {
		Version  int `json:"version"`
		Revision int `json:"revision"`
		Nodes    []struct {
			ID     string          `json:"id"`
			Kind   string          `json:"kind"`
			Config json.RawMessage `json:"config"`
			Policy []struct {
				Action string `json:"action"`
				Mode   string `json:"mode"`
			} `json:"policy"`
		} `json:"nodes"`
		Edges []struct {
			From string `json:"from"`
			To   string `json:"to"`
		} `json:"edges"`
	}
	if json.Unmarshal(raw, &workflow) != nil || workflow.Version != 1 || workflow.Revision < 1 || len(workflow.Nodes) == 0 || len(workflow.Nodes) > 100 || len(workflow.Edges) > 200 {
		return false
	}
	ids := map[string]bool{}
	for _, node := range workflow.Nodes {
		if !validText(node.ID, 1, 100) || ids[node.ID] || !workflowNodeKinds[node.Kind] || !validJSONObject(node.Config) || containsLocalPath(node.Config) {
			return false
		}
		ids[node.ID] = true
		for _, policy := range node.Policy {
			if !agentActionKinds[policy.Action] || (policy.Mode != "automatic" && policy.Mode != "approval") {
				return false
			}
		}
	}
	for _, edge := range workflow.Edges {
		if !ids[edge.From] || !ids[edge.To] {
			return false
		}
	}
	return true
}

func validAgentTrustPolicy(raw json.RawMessage) bool {
	var policy struct {
		AutomaticActions        []string `json:"automaticActions"`
		ApprovalRequiredActions []string `json:"approvalRequiredActions"`
		MemberWriteAccess       bool     `json:"memberWriteAccess"`
		ApprovalTTLHours        int      `json:"approvalTtlHours"`
	}
	if json.Unmarshal(raw, &policy) != nil || policy.MemberWriteAccess || policy.ApprovalTTLHours < 1 || policy.ApprovalTTLHours > 24 {
		return false
	}
	seen := map[string]bool{}
	for _, action := range append(policy.AutomaticActions, policy.ApprovalRequiredActions...) {
		if !agentActionKinds[action] || seen[action] {
			return false
		}
		seen[action] = true
	}
	for _, required := range []string{"overwrite", "rename", "move", "delete", "change_permissions", "outbound_webhook", "external_message"} {
		found := false
		for _, action := range policy.ApprovalRequiredActions {
			found = found || action == required
		}
		if !found {
			return false
		}
	}
	return true
}
func (s *AgentsService) CreateAgent() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		var body agentDefinitionRequest
		if decodeAIJSON(w, r, &body) != nil || !body.valid(true) {
			http.Error(w, "invalid request", 400)
			return
		}
		a, e := s.database.CreateAgentDefinition(userID, db.AgentDefinition{ID: body.ID, DeviceID: body.DeviceID, ScopeID: body.ScopeID, Name: strings.TrimSpace(body.Name), Instructions: strings.TrimSpace(body.Instructions), Workflow: body.Workflow, WorkflowRevision: body.WorkflowRevision, TrustPolicy: body.TrustPolicy, CloudDocumentConsent: body.CloudDocumentConsent})
		writeAgentResult(w, a, e, 201)
	}
}
func (s *AgentsService) ListAgents() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		a, e := s.database.AgentDefinitions(userID)
		if e != nil {
			http.Error(w, "internal error", 500)
			return
		}
		writeJSON(w, 200, map[string]any{"agents": a})
	}
}

func (s *AgentsService) Snapshot() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		agents, err := s.database.AgentDefinitions(userID)
		if err != nil {
			writeAgentError(w, err)
			return
		}
		devices, err := s.database.TrustedDevices(userID)
		if err != nil {
			writeAgentError(w, err)
			return
		}
		jobs, err := s.database.AgentJobs(userID, "", 100)
		if err != nil {
			writeAgentError(w, err)
			return
		}
		approvals, err := s.database.AgentApprovals(userID)
		if err != nil {
			writeAgentError(w, err)
			return
		}
		artifacts, err := s.database.AgentArtifacts(r.Context(), userID, 100)
		if err != nil {
			writeAgentError(w, err)
			return
		}
		definitions := make([]any, 0, len(agents))
		scopes := make([]any, 0, len(agents))
		for _, agent := range agents {
			members, memberErr := s.database.AgentMembers(userID, agent.ID)
			if memberErr != nil {
				writeAgentError(w, memberErr)
				return
			}
			triggers, triggerErr := s.database.AgentTriggers(userID, agent.ID)
			if triggerErr != nil {
				writeAgentError(w, triggerErr)
				return
			}
			scope := map[string]any{"id": agent.ScopeID, "deviceId": agent.DeviceID, "displayName": "Folder", "kind": "local_folder", "relativePath": nil, "available": true}
			scopes = append(scopes, scope)
			definitions = append(definitions, snapshotDefinition(agent, scope, members, triggers))
		}
		deviceViews := make([]any, 0, len(devices))
		var selected any
		for _, device := range devices {
			view := snapshotDevice(device)
			deviceViews = append(deviceViews, view)
			if selected == nil && device.RevokedAt == nil {
				selected = view
			}
		}
		if selected == nil && len(deviceViews) > 0 {
			selected = deviceViews[0]
		}
		jobViews := make([]any, 0, len(jobs))
		for _, job := range jobs {
			jobViews = append(jobViews, snapshotJob(job))
		}
		approvalViews := make([]any, 0, len(approvals))
		for _, approval := range approvals {
			approvalViews = append(approvalViews, snapshotApproval(approval))
		}
		writeJSON(w, 200, map[string]any{"version": 1, "device": selected, "devices": deviceViews, "scopes": scopes, "definitions": definitions, "jobs": jobViews, "approvals": approvalViews, "artifacts": artifacts, "loadedAt": time.Now().UTC()})
	}
}
func (s *AgentsService) GetAgent() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "agentID")
		if !agentIDPattern.MatchString(id) {
			http.Error(w, "invalid request", 400)
			return
		}
		a, e := s.database.AgentDefinition(userID, id)
		writeAgentResult(w, a, e, 200)
	}
}
func (s *AgentsService) UpdateAgent() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "agentID")
		var body agentDefinitionRequest
		if !agentIDPattern.MatchString(id) || decodeAIJSON(w, r, &body) != nil || !body.valid(false) {
			http.Error(w, "invalid request", 400)
			return
		}
		a, e := s.database.UpdateAgentDefinition(userID, db.AgentDefinition{ID: id, Name: strings.TrimSpace(body.Name), Instructions: strings.TrimSpace(body.Instructions), Workflow: body.Workflow, WorkflowRevision: body.WorkflowRevision, TrustPolicy: body.TrustPolicy, CloudDocumentConsent: body.CloudDocumentConsent, Enabled: body.Enabled, Version: body.Version})
		writeAgentResult(w, a, e, 200)
	}
}
func (s *AgentsService) DeleteAgent() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "agentID")
		if !agentIDPattern.MatchString(id) {
			http.Error(w, "invalid request", 400)
			return
		}
		if e := s.database.DeleteAgentDefinition(userID, id); e != nil {
			writeAgentError(w, e)
			return
		}
		w.WriteHeader(204)
	}
}

func (s *AgentsService) Members() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "agentID")
		if !agentIDPattern.MatchString(id) {
			http.Error(w, "invalid request", 400)
			return
		}
		if r.Method == http.MethodGet {
			m, e := s.database.AgentMembers(userID, id)
			if e != nil {
				writeAgentError(w, e)
				return
			}
			writeJSON(w, 200, map[string]any{"members": m})
			return
		}
		var body struct {
			UserIDs []string `json:"userIds"`
			Emails  []string `json:"emails"`
		}
		if decodeAIJSON(w, r, &body) != nil || len(body.UserIDs)+len(body.Emails) > 100 || hasInvalidUserIDs(userID, body.UserIDs) {
			http.Error(w, "invalid request", 400)
			return
		}
		memberIDs := append([]string(nil), body.UserIDs...)
		for _, email := range dedupe(body.Emails) {
			if !validMemberEmail(email) {
				http.Error(w, "invalid request", 400)
				return
			}
			member, _, err := s.database.GetUserByEmail(email)
			if err != nil {
				http.Error(w, "internal error", 500)
				return
			}
			if member == nil {
				writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"code": "misty_account_not_found"})
				return
			}
			if member.ID != userID {
				memberIDs = append(memberIDs, member.ID)
			}
		}
		if e := s.database.ReplaceAgentMembers(userID, id, dedupe(memberIDs)); e != nil {
			writeAgentError(w, e)
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	}
}

func validMemberEmail(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) < 3 || len(value) > 254 || strings.Count(value, "@") != 1 || strings.ContainsAny(value, "\r\n\t ") {
		return false
	}
	parts := strings.SplitN(value, "@", 2)
	return parts[0] != "" && strings.Contains(parts[1], ".")
}
func (s *AgentsService) Triggers() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "agentID")
		if !agentIDPattern.MatchString(id) {
			http.Error(w, "invalid request", 400)
			return
		}
		if r.Method == http.MethodGet {
			t, e := s.database.AgentTriggers(userID, id)
			if e != nil {
				writeAgentError(w, e)
				return
			}
			writeJSON(w, 200, map[string]any{"triggers": t})
			return
		}
		var body struct {
			Triggers []struct {
				Kind    string          `json:"kind"`
				Config  json.RawMessage `json:"config"`
				Enabled bool            `json:"enabled"`
			} `json:"triggers"`
		}
		if decodeAIJSON(w, r, &body) != nil || len(body.Triggers) > 20 {
			http.Error(w, "invalid request", 400)
			return
		}
		triggers := make([]db.AgentTrigger, 0, len(body.Triggers))
		for _, t := range body.Triggers {
			if !triggerKinds[t.Kind] || !validJSONObject(t.Config) || containsLocalPath(t.Config) {
				http.Error(w, "invalid request", 400)
				return
			}
			if t.Kind == "schedule" {
				var scheduleConfig struct {
					Schedule string `json:"schedule"`
				}
				if json.Unmarshal(t.Config, &scheduleConfig) != nil || !db.ValidAgentSchedule(scheduleConfig.Schedule) {
					http.Error(w, "invalid schedule", http.StatusBadRequest)
					return
				}
			}
			triggers = append(triggers, db.AgentTrigger{Kind: t.Kind, Config: t.Config, Enabled: t.Enabled})
		}
		if e := s.database.ReplaceAgentTriggers(userID, id, triggers); e != nil {
			writeAgentError(w, e)
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	}
}

func (s *AgentsService) CreateJob() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		agentID := chi.URLParam(r, "agentID")
		var body struct {
			TriggerKind    string          `json:"triggerKind"`
			IdempotencyKey string          `json:"idempotencyKey"`
			Payload        json.RawMessage `json:"payload"`
		}
		if !agentIDPattern.MatchString(agentID) || decodeAIJSON(w, r, &body) != nil || !triggerKinds[body.TriggerKind] || !validText(body.IdempotencyKey, 8, 200) || !validJSONObject(body.Payload) || containsLocalPath(body.Payload) {
			http.Error(w, "invalid request", 400)
			return
		}
		j, created, e := s.database.CreateAgentJob(userID, agentID, body.TriggerKind, strings.TrimSpace(body.IdempotencyKey), body.Payload)
		status := 200
		if created {
			status = 201
		}
		writeAgentResult(w, j, e, status)
	}
}
func (s *AgentsService) Jobs() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		agentID := strings.TrimSpace(r.URL.Query().Get("agentId"))
		if agentID != "" && !agentIDPattern.MatchString(agentID) {
			http.Error(w, "invalid request", 400)
			return
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		jobs, e := s.database.AgentJobs(userID, agentID, limit)
		if e != nil {
			writeAgentError(w, e)
			return
		}
		writeJSON(w, 200, map[string]any{"jobs": jobs})
	}
}
func (s *AgentsService) GetJob() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "jobID")
		if !jobIDPattern.MatchString(id) {
			http.Error(w, "invalid request", 400)
			return
		}
		j, e := s.database.AgentJob(userID, id)
		writeAgentResult(w, j, e, 200)
	}
}
func (s *AgentsService) CancelJob() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "jobID")
		if !jobIDPattern.MatchString(id) {
			http.Error(w, "invalid request", 400)
			return
		}
		j, e := s.database.CancelAgentJob(userID, id)
		writeAgentResult(w, j, e, 200)
	}
}

func (s *AgentsService) RetryJob() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "jobID")
		if !jobIDPattern.MatchString(id) {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		job, err := s.database.RetryAgentJob(userID, id)
		writeAgentResult(w, job, err, http.StatusCreated)
	}
}

type leaseRequest struct {
	LeaseToken   string          `json:"leaseToken"`
	Progress     int             `json:"progress"`
	Result       json.RawMessage `json:"result"`
	ErrorCode    string          `json:"errorCode"`
	ErrorMessage string          `json:"errorMessage"`
}

func (s *AgentsService) ClaimJob() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		deviceID := chi.URLParam(r, "deviceID")
		if !deviceIDPattern.MatchString(deviceID) {
			http.Error(w, "invalid request", 400)
			return
		}
		j, token, e := s.database.ClaimAgentJob(userID, deviceID, time.Minute)
		if errors.Is(e, db.ErrAgentJobNotFound) {
			w.WriteHeader(204)
			return
		}
		if e != nil {
			writeAgentError(w, e)
			return
		}
		writeJSON(w, 200, map[string]any{"job": j, "leaseToken": token, "leaseExpiresAt": j.LeaseExpiresAt})
	}
}
func (s *AgentsService) LeaseAction(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		deviceID, jobID := chi.URLParam(r, "deviceID"), chi.URLParam(r, "jobID")
		var body leaseRequest
		if !deviceIDPattern.MatchString(deviceID) || !jobIDPattern.MatchString(jobID) || decodeAIJSON(w, r, &body) != nil || !validText(body.LeaseToken, 20, 200) {
			http.Error(w, "invalid request", 400)
			return
		}
		var j *db.AgentJob
		var e error
		switch action {
		case "renew":
			j, e = s.database.RenewAgentJobLease(userID, deviceID, jobID, body.LeaseToken, time.Minute)
		case "start":
			j, e = s.database.StartAgentJob(userID, deviceID, jobID, body.LeaseToken)
		case "progress":
			if body.Progress < 0 || body.Progress > 99 {
				http.Error(w, "invalid request", 400)
				return
			}
			j, e = s.database.ProgressAgentJob(userID, deviceID, jobID, body.LeaseToken, body.Progress)
		case "complete":
			if !validJSONObject(body.Result) || containsLocalPath(body.Result) {
				http.Error(w, "invalid request", 400)
				return
			}
			j, e = s.database.CompleteAgentJob(userID, deviceID, jobID, body.LeaseToken, body.Result)
			if e == nil {
				e = s.recordCompletionArtifact(r.Context(), userID, jobID, body.Result)
			}
		case "fail":
			if !validText(body.ErrorCode, 1, 64) || !validText(body.ErrorMessage, 1, 1000) {
				http.Error(w, "invalid request", 400)
				return
			}
			j, e = s.database.FailAgentJob(userID, deviceID, jobID, body.LeaseToken, body.ErrorCode, body.ErrorMessage)
		}
		writeAgentResult(w, j, e, 200)
	}
}

func (s *AgentsService) recordCompletionArtifact(ctx context.Context, userID, jobID string, raw json.RawMessage) error {
	var result struct {
		Citations json.RawMessage `json:"citations"`
		Artifact  *struct {
			ScopeID      string `json:"scopeId"`
			FileName     string `json:"fileName"`
			RelativePath string `json:"relativePath"`
		} `json:"artifact"`
	}
	if json.Unmarshal(raw, &result) != nil || result.Artifact == nil {
		return nil
	}
	if !scopeIDPattern.MatchString(result.Artifact.ScopeID) || !validText(result.Artifact.FileName, 1, 255) || !validAgentRelativePath(result.Artifact.RelativePath) {
		return errors.New("invalid completion artifact")
	}
	_, err := s.database.RecordAgentArtifact(ctx, userID, jobID, result.Artifact.ScopeID, result.Artifact.FileName, result.Artifact.RelativePath, result.Citations)
	return err
}

func (s *AgentsService) CreateApproval() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		jobID := chi.URLParam(r, "jobID")
		var body struct {
			DeviceID   string          `json:"deviceId"`
			LeaseToken string          `json:"leaseToken"`
			Action     json.RawMessage `json:"action"`
		}
		if !jobIDPattern.MatchString(jobID) || decodeAIJSON(w, r, &body) != nil || !deviceIDPattern.MatchString(body.DeviceID) || !validText(body.LeaseToken, 20, 200) || !validApprovalAction(body.Action) {
			http.Error(w, "invalid request", 400)
			return
		}
		a, e := s.database.CreateAgentApproval(userID, body.DeviceID, jobID, body.LeaseToken, body.Action)
		writeAgentResult(w, a, e, 201)
	}
}
func (s *AgentsService) Approvals() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		approvals, err := s.database.AgentApprovals(userID)
		if err != nil {
			writeAgentError(w, err)
			return
		}
		views := make([]any, 0, len(approvals))
		for _, approval := range approvals {
			views = append(views, snapshotApproval(approval))
		}
		writeJSON(w, 200, map[string]any{"approvals": views})
	}
}
func (s *AgentsService) DecideApproval() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "approvalID")
		var body struct {
			Decision     string `json:"decision"`
			ActionDigest string `json:"actionDigest"`
		}
		if !approvalIDPattern.MatchString(id) || decodeAIJSON(w, r, &body) != nil || !digestPattern.MatchString(body.ActionDigest) {
			http.Error(w, "invalid request", 400)
			return
		}
		approve := body.Decision == "approve" || body.Decision == "approved"
		deny := body.Decision == "reject" || body.Decision == "denied"
		if !approve && !deny {
			http.Error(w, "invalid request", 400)
			return
		}
		a, e := s.database.DecideAgentApproval(userID, id, body.ActionDigest, approve)
		if e != nil {
			writeAgentError(w, e)
			return
		}
		writeJSON(w, 200, snapshotApproval(*a))
	}
}

func snapshotDefinition(a db.AgentDefinition, scope map[string]any, members []db.AgentMember, triggers []db.AgentTrigger) map[string]any {
	status := "disabled"
	if a.Enabled {
		status = "enabled"
	} else if a.Version == 1 {
		status = "draft"
	}
	memberViews := []any{map[string]any{"accountId": a.OwnerUserID, "displayName": "Owner", "role": "owner", "status": "active"}}
	for _, member := range members {
		memberViews = append(memberViews, map[string]any{"accountId": member.UserID, "displayName": "Member", "role": "member", "status": "active"})
	}
	triggerViews := make([]any, 0, len(triggers))
	for _, trigger := range triggers {
		var config map[string]any
		_ = json.Unmarshal(trigger.Config, &config)
		view := map[string]any{"id": trigger.ID, "kind": trigger.Kind, "enabled": trigger.Enabled}
		for _, key := range []string{"schedule", "webhookId"} {
			if value, ok := config[key]; ok {
				view[key] = value
			}
		}
		triggerViews = append(triggerViews, view)
	}
	var workflow map[string]any
	_ = json.Unmarshal(a.Workflow, &workflow)
	return map[string]any{"id": a.ID, "ownerAccountId": a.OwnerUserID, "ownerUserId": a.OwnerUserID, "deviceId": a.DeviceID, "scopeId": a.ScopeID, "scope": scope, "name": a.Name, "instructions": a.Instructions, "status": status, "enabled": a.Enabled, "cloudDocumentConsent": a.CloudDocumentConsent, "members": memberViews, "triggers": triggerViews, "trustPolicy": a.TrustPolicy, "workflow": workflow, "workflowId": workflow["workflowId"], "workflowRevision": a.WorkflowRevision, "version": a.Version, "createdAt": a.CreatedAt, "updatedAt": a.UpdatedAt}
}
func snapshotDevice(d db.TrustedDevice) map[string]any {
	status := "offline"
	if d.RevokedAt != nil {
		status = "revoked"
	} else if time.Since(d.LastSeenAt) < 2*time.Minute {
		status = "online"
	}
	capabilities := []string{}
	var raw map[string]any
	if json.Unmarshal(d.Capabilities, &raw) == nil {
		for key, value := range raw {
			if enabled, ok := value.(bool); ok && enabled {
				capabilities = append(capabilities, key)
			}
		}
	}
	return map[string]any{"id": d.ID, "displayName": d.Name, "status": status, "capabilities": capabilities, "lastSeenAt": d.LastSeenAt}
}
func snapshotJob(j db.AgentJob) map[string]any {
	var result any
	if len(j.Result) > 0 {
		_ = json.Unmarshal(j.Result, &result)
	}
	return map[string]any{"id": j.ID, "agentId": j.AgentID, "deviceId": j.DeviceID, "requesterAccountId": j.RequesterUserID, "triggerKind": j.TriggerKind, "status": j.State, "payload": j.Payload, "result": result, "createdAt": j.CreatedAt, "updatedAt": j.UpdatedAt, "expiresAt": j.ExpiresAt, "leaseExpiresAt": j.LeaseExpiresAt, "startedAt": j.StartedAt, "completedAt": j.CompletedAt, "progress": j.Progress, "error": j.ErrorMessage, "events": []any{}, "artifactIds": []string{}}
}
func snapshotApproval(a db.AgentApproval) map[string]any {
	status := a.State
	if status == "rejected" {
		status = "denied"
	}
	action := map[string]any{}
	_ = json.Unmarshal(a.Action, &action)
	action["digest"] = a.ActionDigest
	return map[string]any{"id": a.ID, "agentId": a.AgentID, "jobId": a.JobID, "requestedByAccountId": a.RequesterUserID, "status": status, "action": action, "createdAt": a.CreatedAt, "expiresAt": a.ExpiresAt, "resolvedAt": a.DecidedAt}
}

func (s *AgentsService) requireUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	id, e := sessionUserID(r, s.database)
	if e != nil {
		http.Error(w, "internal error", 500)
		return "", false
	}
	if id == "" {
		http.Error(w, "not authenticated", 401)
		return "", false
	}
	return id, true
}
func writeAgentResult(w http.ResponseWriter, v any, e error, status int) {
	if e != nil {
		writeAgentError(w, e)
		return
	}
	writeJSON(w, status, v)
}
func writeAgentError(w http.ResponseWriter, e error) {
	switch {
	case errors.Is(e, db.ErrAgentNotFound), errors.Is(e, db.ErrDeviceNotFound), errors.Is(e, db.ErrAgentJobNotFound), errors.Is(e, db.ErrApprovalNotFound):
		http.Error(w, "not found", 404)
	case errors.Is(e, db.ErrInvalidLease):
		writeJSON(w, 409, map[string]string{"code": "invalid_or_expired_lease"})
	case errors.Is(e, db.ErrInvalidJobState), errors.Is(e, db.ErrApprovalNotPending):
		writeJSON(w, 409, map[string]string{"code": "invalid_state"})
	case errors.Is(e, db.ErrAgentVersionConflict):
		writeJSON(w, 409, map[string]string{"code": "agent_version_conflict", "message": "This agent changed elsewhere. Refresh before saving again."})
	case errors.Is(e, db.ErrApprovalAction):
		writeJSON(w, 400, map[string]string{"code": "invalid_approval_action"})
	default:
		http.Error(w, "internal error", 500)
	}
}
func validText(v string, min, max int) bool {
	n := utf8.RuneCountInString(strings.TrimSpace(v))
	return n >= min && n <= max
}
func validJSONObject(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return false
	}
	_, ok := value.(map[string]any)
	return ok
}
func validDeviceRegistration(name, key, algorithm string, capabilities json.RawMessage) bool {
	decodedKey, err := decodeDeviceBase64(key)
	return validText(name, 1, 100) && err == nil && len(decodedKey) == ed25519.PublicKeySize && (algorithm == "" || algorithm == "ed25519") && validJSONObject(capabilities) && !containsLocalPath(capabilities)
}

func decodeDeviceBase64(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if decoded, err := encoding.DecodeString(value); err == nil {
			return decoded, nil
		}
	}
	return nil, errors.New("invalid base64")
}
func containsLocalPath(raw json.RawMessage) bool {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return true
	}
	return containsPathValue(value)
}
func containsPathValue(v any) bool {
	switch value := v.(type) {
	case map[string]any:
		for k, item := range value {
			key := strings.ToLower(strings.ReplaceAll(k, "_", ""))
			if key == "relativepath" || key == "destinationrelativepath" {
				path, ok := item.(string)
				if !ok || !validAgentRelativePath(path) {
					return true
				}
				continue
			}
			if key == "relativepaths" {
				paths, ok := item.([]any)
				if !ok {
					return true
				}
				for _, candidate := range paths {
					path, ok := candidate.(string)
					if !ok || !validAgentRelativePath(path) {
						return true
					}
				}
				continue
			}
			if key == "path" || strings.HasSuffix(key, "path") || key == "local_path" {
				return true
			}
			if containsPathValue(item) {
				return true
			}
		}
	case []any:
		for _, item := range value {
			if containsPathValue(item) {
				return true
			}
		}
	}
	return false
}

func validAgentRelativePath(path string) bool {
	path = strings.TrimSpace(strings.ReplaceAll(path, "\\", "/"))
	if path == "" || strings.HasPrefix(path, "/") || strings.Contains(path, ":") || len(path) > 1024 {
		return false
	}
	for _, part := range strings.Split(path, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func validApprovalAction(raw json.RawMessage) bool {
	var action struct {
		Kind                    string   `json:"kind"`
		Summary                 string   `json:"summary"`
		ScopeID                 string   `json:"scopeId"`
		RelativePaths           []string `json:"relativePaths"`
		DestinationRelativePath string   `json:"destinationRelativePath"`
		ContentSHA256           string   `json:"contentSha256"`
		UnixMode                *uint32  `json:"unixMode"`
	}
	if json.Unmarshal(raw, &action) != nil || !agentActionKinds[action.Kind] ||
		!validText(action.Summary, 1, 1000) || !scopeIDPattern.MatchString(action.ScopeID) ||
		len(action.RelativePaths) > 100 || containsLocalPath(raw) {
		return false
	}
	for _, path := range action.RelativePaths {
		if !validAgentRelativePath(path) {
			return false
		}
	}
	if action.Kind == "overwrite" && !digestPattern.MatchString(action.ContentSHA256) {
		return false
	}
	if action.Kind == "change_permissions" && (action.UnixMode == nil || *action.UnixMode > 0o777) {
		return false
	}
	return action.DestinationRelativePath == "" || validAgentRelativePath(action.DestinationRelativePath)
}

func hasInvalidUserIDs(owner string, ids []string) bool {
	seen := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || id == owner || len(id) > 100 || seen[id] {
			return true
		}
		seen[id] = true
	}
	return false
}
func dedupe(ids []string) []string {
	out := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
