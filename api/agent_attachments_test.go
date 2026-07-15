package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/server/db"
)

type fakeAgentAttachmentRepository struct {
	created       *db.AgentAttachment
	attachment    *db.AgentAttachment
	createErr     error
	finalized     bool
	expired       []db.AgentAttachment
	purged        []string
	finalizeToken string
}

func (f *fakeAgentAttachmentRepository) CreateAgentAttachment(_ context.Context, _ string, attachment db.AgentAttachment) (*db.AgentAttachment, error) {
	if f.createErr != nil {
		return nil, f.createErr
	}
	attachment.State = "initiated"
	if attachment.CreatedAt.IsZero() {
		attachment.CreatedAt = time.Now().UTC()
	}
	f.created = &attachment
	f.attachment = &attachment
	return &attachment, nil
}
func (f *fakeAgentAttachmentRepository) AgentAttachment(_ context.Context, _, _, _ string) (*db.AgentAttachment, error) {
	if f.attachment == nil {
		return nil, db.ErrAgentAttachmentNotFound
	}
	return f.attachment, nil
}
func (f *fakeAgentAttachmentRepository) FinalizeAgentAttachment(_ context.Context, _, _, _, token string, _ int64, _ string) (*db.AgentAttachment, error) {
	if f.attachment == nil || token != f.attachment.UploadTokenHash {
		return nil, db.ErrAgentAttachmentToken
	}
	f.finalizeToken = token
	f.finalized = true
	f.attachment.State = "ready"
	return f.attachment, nil
}
func (f *fakeAgentAttachmentRepository) DeleteAgentAttachment(_ context.Context, _, _, _ string) (*db.AgentAttachment, error) {
	if f.attachment == nil {
		return nil, db.ErrAgentAttachmentNotFound
	}
	f.attachment.State = "deleted"
	return f.attachment, nil
}
func (f *fakeAgentAttachmentRepository) ExpiredAgentAttachments(_ context.Context, _ time.Time, _ int) ([]db.AgentAttachment, error) {
	return f.expired, nil
}
func (f *fakeAgentAttachmentRepository) MarkAgentAttachmentPurged(_ context.Context, id string) error {
	f.purged = append(f.purged, id)
	for index := range f.expired {
		if f.expired[index].ID == id {
			f.expired[index].WrappedDataKey = ""
		}
	}
	return nil
}

func testAgentAttachmentsService(repository agentAttachmentRepository, store AgentAttachmentStore) *AgentAttachmentsService {
	service := newAgentAttachmentsService(repository, store, bytes.Repeat([]byte{0x42}, 32), func(*http.Request) (string, error) {
		return "user_test", nil
	})
	service.now = func() time.Time { return time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC) }
	return service
}

func validInitiateBody(t *testing.T, ciphertext []byte) []byte {
	t.Helper()
	sum := sha256.Sum256(ciphertext)
	body := initiateAgentAttachmentRequest{
		DisplayName: "report.pdf", MediaType: "application/pdf", PlaintextByteSize: int64(len(ciphertext) - 1),
		CiphertextByteSize: int64(len(ciphertext)), PageCount: 8, CiphertextSHA256: hex.EncodeToString(sum[:]),
		WrappedDataKey:   base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0xa5}, 48)),
		KeyWrapAlgorithm: "KMS", KeyWrapKeyID: "misty-agent-key-v1", ContentEncryption: "AES-256-GCM",
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestAgentAttachmentInitiationEnforcesFileAndTaskLimits(t *testing.T) {
	jobID := "job_11111111-1111-4111-8111-111111111111"
	tests := []struct {
		name       string
		mutate     func(*initiateAgentAttachmentRequest)
		repoError  error
		wantStatus int
		wantCode   string
	}{
		{name: "plaintext over 50 MiB", mutate: func(body *initiateAgentAttachmentRequest) {
			body.PlaintextByteSize = db.MaxAgentAttachmentBytes + 1
			body.CiphertextByteSize = body.PlaintextByteSize
		}, wantStatus: 400},
		{name: "single document over 200 pages", mutate: func(body *initiateAgentAttachmentRequest) { body.PageCount = 201 }, wantStatus: 400},
		{name: "eleventh file", repoError: db.ErrAgentAttachmentLimit, wantStatus: 422, wantCode: "attachment_limit_exceeded"},
		{name: "aggregate pages over 200", repoError: db.ErrAgentDocumentPageLimit, wantStatus: 422, wantCode: "document_page_limit_exceeded"},
		{name: "different envelope for same job", repoError: db.ErrAgentAttachmentEnvelope, wantStatus: 409, wantCode: "job_encryption_envelope_mismatch"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ciphertext := []byte("encrypted-payload")
			var body initiateAgentAttachmentRequest
			if err := json.Unmarshal(validInitiateBody(t, ciphertext), &body); err != nil {
				t.Fatal(err)
			}
			if test.mutate != nil {
				test.mutate(&body)
			}
			payload, _ := json.Marshal(body)
			repository := &fakeAgentAttachmentRepository{createErr: test.repoError}
			service := testAgentAttachmentsService(repository, NewMemoryAgentAttachmentStore())
			router := chi.NewRouter()
			router.Post("/jobs/{jobID}/attachments/initiate", service.InitiateUpload())
			request := httptest.NewRequest(http.MethodPost, "/jobs/"+jobID+"/attachments/initiate", bytes.NewReader(payload))
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
			if test.wantCode != "" && !bytes.Contains(response.Body.Bytes(), []byte(test.wantCode)) {
				t.Fatalf("expected code %q in %s", test.wantCode, response.Body.String())
			}
		})
	}
}

func TestAgentAttachmentUploadTokenCannotCrossJobsOrOutliveGrant(t *testing.T) {
	repository := &fakeAgentAttachmentRepository{}
	store := NewMemoryAgentAttachmentStore()
	service := testAgentAttachmentsService(repository, store)
	attachmentID := "attachment_22222222-2222-4222-8222-222222222222"
	jobID := "job_11111111-1111-4111-8111-111111111111"
	otherJobID := "job_33333333-3333-4333-8333-333333333333"
	claims := agentUploadClaims{Version: 1, AttachmentID: attachmentID, JobID: jobID, StorageKey: "agents/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222", ByteSize: 10, SHA256: string(bytes.Repeat([]byte{'a'}, 64)), ExpiresAt: service.now().Add(time.Minute).Unix(), Nonce: "nonce"}
	token, err := service.signUploadClaims(claims)
	if err != nil {
		t.Fatal(err)
	}

	callFinalize := func(routeJob string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(finalizeAgentAttachmentRequest{UploadToken: token})
		router := chi.NewRouter()
		router.Post("/jobs/{jobID}/attachments/{attachmentID}/finalize", service.FinalizeUpload())
		request := httptest.NewRequest(http.MethodPost, "/jobs/"+routeJob+"/attachments/"+attachmentID+"/finalize", bytes.NewReader(body))
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	if response := callFinalize(otherJobID); response.Code != http.StatusForbidden {
		t.Fatalf("cross-job token status = %d, body = %s", response.Code, response.Body.String())
	}

	service.now = func() time.Time { return time.Date(2026, 7, 14, 12, 2, 0, 0, time.UTC) }
	if response := callFinalize(jobID); response.Code != http.StatusForbidden {
		t.Fatalf("expired token status = %d, body = %s", response.Code, response.Body.String())
	}
	if repository.finalized {
		t.Fatal("repository finalized a rejected upload token")
	}
}

func TestAgentAttachmentFinalizeRequiresExactCiphertext(t *testing.T) {
	repository := &fakeAgentAttachmentRepository{}
	store := NewMemoryAgentAttachmentStore()
	service := testAgentAttachmentsService(repository, store)
	jobID := "job_11111111-1111-4111-8111-111111111111"
	ciphertext := []byte("encrypted-payload")
	router := chi.NewRouter()
	router.Post("/jobs/{jobID}/attachments/initiate", service.InitiateUpload())
	router.Put("/jobs/{jobID}/attachments/{attachmentID}/content", service.UploadContent())
	router.Post("/jobs/{jobID}/attachments/{attachmentID}/finalize", service.FinalizeUpload())

	request := httptest.NewRequest(http.MethodPost, "/jobs/"+jobID+"/attachments/initiate", bytes.NewReader(validInitiateBody(t, ciphertext)))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("initiate status = %d, body = %s", response.Code, response.Body.String())
	}
	if bytes.Contains(response.Body.Bytes(), []byte(repository.created.WrappedDataKey)) {
		t.Fatal("initiation response exposed wrapped key material")
	}
	if repository.created.ExpiresAt.Sub(service.now()) != 24*time.Hour || repository.created.UploadExpiresAt.Sub(service.now()) != 15*time.Minute {
		t.Fatalf("unexpected retention: upload=%s attachment=%s", repository.created.UploadExpiresAt, repository.created.ExpiresAt)
	}
	if !repository.created.CreatedAt.Equal(service.now()) || repository.created.ExpiresAt.Sub(repository.created.CreatedAt) != 24*time.Hour {
		t.Fatalf("attachment timestamps do not share the server retention base: created=%s expires=%s", repository.created.CreatedAt, repository.created.ExpiresAt)
	}
	var initiated struct {
		UploadToken string `json:"uploadToken"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &initiated); err != nil {
		t.Fatal(err)
	}
	if err := store.PutCiphertext(repository.created.StorageKey, []byte("wrong")); err == nil {
		t.Fatal("store accepted ciphertext outside the signed size/checksum constraints")
	}
	uploadRequest := httptest.NewRequest(http.MethodPut, "/jobs/"+jobID+"/attachments/"+repository.created.ID+"/content", bytes.NewReader(ciphertext))
	uploadRequest.Header.Set(agentAttachmentUploadTokenHeader, initiated.UploadToken)
	uploadResponse := httptest.NewRecorder()
	router.ServeHTTP(uploadResponse, uploadRequest)
	if uploadResponse.Code != http.StatusNoContent {
		t.Fatalf("server upload status = %d, body = %s", uploadResponse.Code, uploadResponse.Body.String())
	}
	finalizeBody, _ := json.Marshal(finalizeAgentAttachmentRequest{UploadToken: initiated.UploadToken})
	request = httptest.NewRequest(http.MethodPost, "/jobs/"+jobID+"/attachments/"+repository.created.ID+"/finalize", bytes.NewReader(finalizeBody))
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !repository.finalized {
		t.Fatalf("finalize status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestAgentAttachmentPurgeDeletesObjectBeforeWrappedKeyRecord(t *testing.T) {
	store := NewMemoryAgentAttachmentStore()
	ciphertext := []byte("ciphertext")
	sum := sha256.Sum256(ciphertext)
	key := "agents/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222"
	if _, err := store.PresignPut(context.Background(), key, int64(len(ciphertext)), "application/octet-stream", hex.EncodeToString(sum[:]), time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := store.PutCiphertext(key, ciphertext); err != nil {
		t.Fatal(err)
	}
	repository := &fakeAgentAttachmentRepository{expired: []db.AgentAttachment{{ID: "attachment_22222222-2222-4222-8222-222222222222", StorageKey: key, WrappedDataKey: "wrapped-not-plaintext"}}}
	service := testAgentAttachmentsService(repository, store)
	purged, err := service.PurgeExpired(context.Background(), 100)
	if err != nil || purged != 1 {
		t.Fatalf("purged = %d, err = %v", purged, err)
	}
	if _, err := store.Head(context.Background(), key); !errors.Is(err, ErrAgentObjectNotFound) {
		t.Fatalf("expired object still exists: %v", err)
	}
	if len(repository.purged) != 1 || repository.purged[0] != repository.expired[0].ID {
		t.Fatalf("purged records = %#v", repository.purged)
	}
	if repository.expired[0].WrappedDataKey != "" {
		t.Fatal("wrapped key was retained after purge")
	}
}
