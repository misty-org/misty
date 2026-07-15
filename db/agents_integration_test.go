package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestAgentJobLeaseLifecycleAndIdempotency(t *testing.T) {
	database := openTestDatabase(t)
	user, err := database.CreateUser("Agent Owner", "agent-owner@example.com", "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	device, err := database.RegisterTrustedDevice(user.ID, "Test Mac", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", json.RawMessage(`{"documents":true}`))
	if err != nil {
		t.Fatal(err)
	}
	agent, err := database.CreateAgentDefinition(user.ID, AgentDefinition{ID: "agent_11111111-1111-1111-1111-111111111111", DeviceID: device.ID, ScopeID: "scope_abcdefgh", Name: "Reports", Instructions: "Summarize reports", Workflow: json.RawMessage(`{"nodes":[]}`), WorkflowRevision: 1, TrustPolicy: json.RawMessage(`{"memberWriteAccess":false}`)})
	if err != nil {
		t.Fatal(err)
	}
	agent.Enabled = true
	staleAgent := *agent
	agent, err = database.UpdateAgentDefinition(user.ID, *agent)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = database.UpdateAgentDefinition(user.ID, staleAgent); !errors.Is(err, ErrAgentVersionConflict) {
		t.Fatalf("stale agent update error=%v", err)
	}
	job, created, err := database.CreateAgentJob(user.ID, agent.ID, "manual", "request-123", json.RawMessage(`{"scopeId":"scope_abcdefgh"}`))
	if err != nil || !created {
		t.Fatalf("CreateAgentJob() created=%v error=%v", created, err)
	}
	duplicate, created, err := database.CreateAgentJob(user.ID, agent.ID, "manual", "request-123", json.RawMessage(`{"scopeId":"scope_abcdefgh"}`))
	if err != nil || created || duplicate.ID != job.ID {
		t.Fatalf("idempotent CreateAgentJob() = %#v, created=%v, error=%v", duplicate, created, err)
	}
	leased, token, err := database.ClaimAgentJob(user.ID, device.ID, time.Minute)
	if err != nil || leased.ID != job.ID || token == "" {
		t.Fatalf("ClaimAgentJob() = %#v, token=%q, error=%v", leased, token, err)
	}
	if _, err = database.StartAgentJob(user.ID, device.ID, job.ID, "wrong-token"); !errors.Is(err, ErrInvalidLease) {
		t.Fatalf("wrong token error=%v", err)
	}
	if _, err = database.StartAgentJob(user.ID, device.ID, job.ID, token); err != nil {
		t.Fatal(err)
	}
	if _, err = database.ProgressAgentJob(user.ID, device.ID, job.ID, token, 60); err != nil {
		t.Fatal(err)
	}
	completed, err := database.CompleteAgentJob(user.ID, device.ID, job.ID, token, json.RawMessage(`{"summary":"done"}`))
	if err != nil || completed.State != AgentJobCompleted || completed.Progress != 100 {
		t.Fatalf("CompleteAgentJob()=%#v,error=%v", completed, err)
	}
	artifact, err := database.RecordAgentArtifact(t.Context(), user.ID, job.ID, agent.ScopeID, "report.misty-summary.md", "report.misty-summary.md", json.RawMessage(`[]`))
	if err != nil || artifact.JobID != job.ID || artifact.AgentID != agent.ID {
		t.Fatalf("RecordAgentArtifact()=%#v,error=%v", artifact, err)
	}
	artifacts, err := database.AgentArtifacts(t.Context(), user.ID, 10)
	if err != nil || len(artifacts) != 1 || artifacts[0].ID != artifact.ID {
		t.Fatalf("AgentArtifacts()=%#v,error=%v", artifacts, err)
	}
	replayed, err := database.CompleteAgentJob(user.ID, device.ID, job.ID, token, json.RawMessage(`{"summary":"ignored"}`))
	if err != nil || replayed.ID != completed.ID {
		t.Fatalf("idempotent completion=%#v,error=%v", replayed, err)
	}
	crashJob, _, err := database.CreateAgentJob(user.ID, agent.ID, "manual", "request-crash", json.RawMessage(`{"scopeId":"scope_abcdefgh"}`))
	if err != nil {
		t.Fatal(err)
	}
	_, crashToken, err := database.ClaimAgentJob(user.ID, device.ID, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = database.StartAgentJob(user.ID, device.ID, crashJob.ID, crashToken); err != nil {
		t.Fatal(err)
	}
	if err = database.agentTx(user.ID, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE agent_jobs SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`, crashJob.ID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	recovered, recoveryToken, err := database.ClaimAgentJob(user.ID, device.ID, time.Minute)
	if err != nil || recovered.ID != crashJob.ID || recoveryToken == crashToken || recovered.AttemptCount != 2 {
		t.Fatalf("crash recovery=%#v,token changed=%v,error=%v", recovered, recoveryToken != crashToken, err)
	}
	if _, err = database.CompleteAgentJob(user.ID, device.ID, crashJob.ID, recoveryToken, json.RawMessage(`{"recovered":true}`)); err != nil {
		t.Fatal(err)
	}
	approvalJob, _, err := database.CreateAgentJob(user.ID, agent.ID, "manual", "request-approval", json.RawMessage(`{"scopeId":"scope_abcdefgh"}`))
	if err != nil {
		t.Fatal(err)
	}
	_, approvalToken, err := database.ClaimAgentJob(user.ID, device.ID, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = database.StartAgentJob(user.ID, device.ID, approvalJob.ID, approvalToken); err != nil {
		t.Fatal(err)
	}
	action := json.RawMessage(`{"kind":"delete","summary":"Delete one generated artifact","scopeId":"scope_abcdefgh","relativePaths":["generated.md"]}`)
	approval, err := database.CreateAgentApproval(user.ID, device.ID, approvalJob.ID, approvalToken, action)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = database.DecideAgentApproval(user.ID, approval.ID, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", true); !errors.Is(err, ErrApprovalNotPending) {
		t.Fatalf("mismatched digest error=%v", err)
	}
	approvals, err := database.AgentApprovals(user.ID)
	if err != nil || len(approvals) != 1 || approvals[0].State != "pending" {
		t.Fatalf("AgentApprovals()=%#v,error=%v", approvals, err)
	}
	resolved, err := database.DecideAgentApproval(user.ID, approval.ID, approval.ActionDigest, true)
	if err != nil || resolved.State != "approved" {
		t.Fatalf("DecideAgentApproval()=%#v,error=%v", resolved, err)
	}
	if err := database.RevokeTrustedDevice(user.ID, device.ID); err != nil {
		t.Fatal(err)
	}
}

func TestRetryFailedAgentJobRequeuesSameRun(t *testing.T) {
	database := openTestDatabase(t)
	user, err := database.CreateUser("Retry Owner", "agent-retry@example.com", "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	device, err := database.RegisterTrustedDevice(user.ID, "Retry Mac", "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", json.RawMessage(`{"documents":true}`))
	if err != nil {
		t.Fatal(err)
	}
	agent, err := database.CreateAgentDefinition(user.ID, AgentDefinition{
		ID: "agent_22222222-2222-4222-8222-222222222222", DeviceID: device.ID,
		ScopeID: "scope_retry123", Name: "Retry reports", Instructions: "Summarize reports",
		Workflow: json.RawMessage(`{"nodes":[]}`), WorkflowRevision: 1,
		TrustPolicy: json.RawMessage(`{"memberWriteAccess":false}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	agent.Enabled = true
	agent.CloudDocumentConsent = true
	agent, err = database.UpdateAgentDefinition(user.ID, *agent)
	if err != nil {
		t.Fatal(err)
	}
	payload := json.RawMessage(`{"scopeId":"scope_retry123","fileName":"report.pdf"}`)
	original, created, err := database.CreateAgentJob(user.ID, agent.ID, "file_created", "retry-source-123", payload)
	if err != nil || !created {
		t.Fatalf("CreateAgentJob() created=%v error=%v", created, err)
	}
	_, leaseToken, err := database.ClaimAgentJob(user.ID, device.ID, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	firstCreatedAt := time.Now().UTC()
	firstAttachment, err := database.CreateAgentAttachment(t.Context(), user.ID, AgentAttachment{
		ID: "attachment_33333333-3333-4333-8333-333333333333", JobID: original.ID,
		DocumentID: "document_33333333333343338333333333333333", DisplayName: "report.pdf", MediaType: "application/pdf",
		PlaintextByteSize: 10, CiphertextByteSize: 26, PageCount: 1,
		StorageKey:       "agents/" + strings.TrimPrefix(original.ID, "job_") + "/33333333-3333-4333-8333-333333333333",
		CiphertextSHA256: strings.Repeat("a", 64), WrappedDataKey: strings.Repeat("b", 32),
		KeyWrapAlgorithm: "RSA-OAEP-SHA256", KeyWrapKeyID: "2026-07", ContentEncryption: "AES-256-GCM",
		UploadTokenHash: strings.Repeat("c", 64), CreatedAt: firstCreatedAt,
		UploadExpiresAt: firstCreatedAt.Add(15 * time.Minute), ExpiresAt: firstCreatedAt.Add(24 * time.Hour),
	})
	if err != nil || firstAttachment.ExpiresAt.Sub(firstAttachment.CreatedAt) != 24*time.Hour {
		t.Fatalf("CreateAgentAttachment()=%#v error=%v", firstAttachment, err)
	}
	failed, err := database.FailAgentJob(user.ID, device.ID, original.ID, leaseToken, "attachment_failed", "upload failed")
	if err != nil || failed.State != AgentJobFailed {
		t.Fatalf("FailAgentJob()=%#v error=%v", failed, err)
	}

	retried, err := database.RetryAgentJob(user.ID, original.ID)
	if err != nil {
		t.Fatal(err)
	}
	var retriedPayload, originalPayload map[string]any
	if json.Unmarshal(retried.Payload, &retriedPayload) != nil || json.Unmarshal(payload, &originalPayload) != nil {
		t.Fatal("retry payload was not valid JSON")
	}
	if retried.ID != original.ID || retried.State != AgentJobQueued || retried.AgentID != original.AgentID || retried.TriggerKind != original.TriggerKind || !reflect.DeepEqual(retriedPayload, originalPayload) {
		t.Fatalf("RetryAgentJob()=%#v original=%#v", retried, original)
	}
	if retried.IdempotencyKey != original.IdempotencyKey || retried.AttemptCount != 1 || retried.ErrorMessage != "" || retried.CompletedAt != nil {
		t.Fatalf("retry did not reset terminal state in place: %#v", retried)
	}
	expiredAttachment, err := database.AgentAttachment(t.Context(), user.ID, original.ID, firstAttachment.ID)
	if err != nil || expiredAttachment.ExpiresAt.After(time.Now()) {
		t.Fatalf("failed-attempt attachment was not expired: %#v error=%v", expiredAttachment, err)
	}
	createdAt := time.Now().UTC()
	attachment, err := database.CreateAgentAttachment(t.Context(), user.ID, AgentAttachment{
		ID: "attachment_44444444-4444-4444-8444-444444444444", JobID: retried.ID,
		DocumentID: "document_33333333333343338333333333333333", DisplayName: "report.pdf", MediaType: "application/pdf",
		PlaintextByteSize: 10, CiphertextByteSize: 26, PageCount: 1,
		StorageKey:       "agents/" + strings.TrimPrefix(retried.ID, "job_") + "/44444444-4444-4444-8444-444444444444",
		CiphertextSHA256: strings.Repeat("d", 64), WrappedDataKey: strings.Repeat("e", 32),
		KeyWrapAlgorithm: "RSA-OAEP-SHA256", KeyWrapKeyID: "2026-07", ContentEncryption: "AES-256-GCM",
		UploadTokenHash: strings.Repeat("f", 64), CreatedAt: createdAt,
		UploadExpiresAt: createdAt.Add(15 * time.Minute), ExpiresAt: createdAt.Add(24 * time.Hour),
	})
	if err != nil || attachment.ExpiresAt.Sub(attachment.CreatedAt) != 24*time.Hour {
		t.Fatalf("CreateAgentAttachment()=%#v error=%v", attachment, err)
	}
	jobs, err := database.AgentJobs(user.ID, agent.ID, 10)
	if err != nil || len(jobs) != 1 || jobs[0].ID != original.ID {
		t.Fatalf("retry created another history row: jobs=%#v error=%v", jobs, err)
	}
	if _, err := database.RetryAgentJob(user.ID, retried.ID); !errors.Is(err, ErrInvalidJobState) {
		t.Fatalf("retrying queued run error=%v", err)
	}
}
