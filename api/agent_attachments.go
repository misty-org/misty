package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/kannachi323/misty/server/db"
)

const agentAttachmentUploadTokenHeader = "X-Misty-Attachment-Upload-Token"

const (
	agentAttachmentRetention = 24 * time.Hour
	agentUploadWindow        = 15 * time.Minute
	maxCiphertextOverhead    = int64(64 << 10)
)

var (
	attachmentIDPattern = regexp.MustCompile(`^attachment_[0-9a-f-]{36}$`)
	documentIDPattern   = regexp.MustCompile(`^document_[0-9a-f]{32}$`)
	sha256Pattern       = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

type agentAttachmentRepository interface {
	CreateAgentAttachment(context.Context, string, db.AgentAttachment) (*db.AgentAttachment, error)
	AgentAttachment(context.Context, string, string, string) (*db.AgentAttachment, error)
	FinalizeAgentAttachment(context.Context, string, string, string, string, int64, string) (*db.AgentAttachment, error)
	DeleteAgentAttachment(context.Context, string, string, string) (*db.AgentAttachment, error)
	ExpiredAgentAttachments(context.Context, time.Time, int) ([]db.AgentAttachment, error)
	MarkAgentAttachmentPurged(context.Context, string) error
}

type agentAttachmentAuthenticator func(*http.Request) (string, error)

type AgentAttachmentsService struct {
	repository   agentAttachmentRepository
	store        AgentAttachmentStore
	authenticate agentAttachmentAuthenticator
	signingKey   []byte
	envelopeKeys *AgentAttachmentEnvelopeKeyring
	now          func() time.Time
}

func NewAgentAttachmentsService(database *db.Database, store AgentAttachmentStore, signingKey []byte) (*AgentAttachmentsService, error) {
	if database == nil || store == nil || len(signingKey) < 32 {
		return nil, errors.New("agent attachments require a database, object store, and at least 32 signing-key bytes")
	}
	return newAgentAttachmentsService(database, store, signingKey, func(r *http.Request) (string, error) {
		return sessionUserID(r, database)
	}), nil
}

func newAgentAttachmentsService(repository agentAttachmentRepository, store AgentAttachmentStore, signingKey []byte, authenticate agentAttachmentAuthenticator) *AgentAttachmentsService {
	return &AgentAttachmentsService{
		repository:   repository,
		store:        store,
		authenticate: authenticate,
		signingKey:   append([]byte(nil), signingKey...),
		now:          func() time.Time { return time.Now().UTC() },
	}
}

type initiateAgentAttachmentRequest struct {
	DocumentID         string `json:"documentId"`
	DisplayName        string `json:"displayName"`
	MediaType          string `json:"mediaType"`
	PlaintextByteSize  int64  `json:"plaintextByteSize"`
	CiphertextByteSize int64  `json:"ciphertextByteSize"`
	PageCount          int    `json:"pageCount"`
	CiphertextSHA256   string `json:"ciphertextSha256"`
	WrappedDataKey     string `json:"wrappedDataKey"`
	KeyWrapAlgorithm   string `json:"keyWrapAlgorithm"`
	KeyWrapKeyID       string `json:"keyWrapKeyId"`
	ContentEncryption  string `json:"contentEncryption"`
}

func (b *initiateAgentAttachmentRequest) valid() bool {
	if !validAgentAttachmentName(b.DisplayName) || !validAgentAttachmentMediaType(b.MediaType) {
		return false
	}
	if b.PlaintextByteSize < 1 || b.PlaintextByteSize > db.MaxAgentAttachmentBytes {
		return false
	}
	if b.CiphertextByteSize < b.PlaintextByteSize || b.CiphertextByteSize > db.MaxAgentAttachmentBytes+maxCiphertextOverhead {
		return false
	}
	if b.PageCount < 0 || b.PageCount > db.MaxAgentDocumentPages || !sha256Pattern.MatchString(b.CiphertextSHA256) {
		return false
	}
	if b.ContentEncryption == "" {
		b.ContentEncryption = "AES-256-GCM"
	}
	if b.ContentEncryption != "AES-256-GCM" || !validWrappedDataKey(b.WrappedDataKey) || !validAgentAttachmentMetadata(b.KeyWrapKeyID, 512) {
		return false
	}
	switch b.KeyWrapAlgorithm {
	case "RSA-OAEP-SHA256", "AES-KW", "KMS":
		return true
	default:
		return false
	}
}

func (s *AgentAttachmentsService) InitiateUpload() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		jobID := chi.URLParam(r, "jobID")
		var body initiateAgentAttachmentRequest
		if !jobIDPattern.MatchString(jobID) || decodeAIJSON(w, r, &body) != nil || !body.valid() {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		now := s.now()
		attachmentID := "attachment_" + uuid.NewString()
		if body.DocumentID == "" {
			body.DocumentID = "document_" + strings.ReplaceAll(strings.TrimPrefix(attachmentID, "attachment_"), "-", "")
		}
		if !documentIDPattern.MatchString(body.DocumentID) {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		storageKey := "agents/" + strings.TrimPrefix(jobID, "job_") + "/" + strings.TrimPrefix(attachmentID, "attachment_")
		claims := agentUploadClaims{
			Version: 1, AttachmentID: attachmentID, JobID: jobID, StorageKey: storageKey,
			ByteSize: body.CiphertextByteSize, SHA256: body.CiphertextSHA256,
			ExpiresAt: now.Add(agentUploadWindow).Unix(), Nonce: uuid.NewString(),
		}
		uploadToken, err := s.signUploadClaims(claims)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		tokenHash := hashAgentUploadToken(uploadToken)
		attachment, err := s.repository.CreateAgentAttachment(r.Context(), userID, db.AgentAttachment{
			ID: attachmentID, JobID: jobID, DocumentID: body.DocumentID, DisplayName: strings.TrimSpace(body.DisplayName), MediaType: strings.TrimSpace(body.MediaType),
			PlaintextByteSize: body.PlaintextByteSize, CiphertextByteSize: body.CiphertextByteSize,
			PageCount: body.PageCount, StorageKey: storageKey, CiphertextSHA256: body.CiphertextSHA256,
			WrappedDataKey: body.WrappedDataKey, KeyWrapAlgorithm: body.KeyWrapAlgorithm,
			KeyWrapKeyID: body.KeyWrapKeyID, ContentEncryption: body.ContentEncryption, UploadTokenHash: tokenHash,
			CreatedAt: now, UploadExpiresAt: now.Add(agentUploadWindow), ExpiresAt: now.Add(agentAttachmentRetention),
		})
		if err != nil {
			writeAgentAttachmentError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"attachment": attachment, "uploadToken": uploadToken,
		})
	}
}

type finalizeAgentAttachmentRequest struct {
	UploadToken string `json:"uploadToken"`
}

func (s *AgentAttachmentsService) FinalizeUpload() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		jobID, attachmentID := chi.URLParam(r, "jobID"), chi.URLParam(r, "attachmentID")
		var body finalizeAgentAttachmentRequest
		if !jobIDPattern.MatchString(jobID) || !attachmentIDPattern.MatchString(attachmentID) || decodeAIJSON(w, r, &body) != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		claims, err := s.verifyUploadClaims(body.UploadToken)
		if err != nil || claims.JobID != jobID || claims.AttachmentID != attachmentID || claims.ExpiresAt < s.now().Unix() {
			writeJSON(w, http.StatusForbidden, map[string]string{"code": "invalid_upload_token"})
			return
		}
		metadata, err := s.store.Head(r.Context(), claims.StorageKey)
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"code": "upload_missing"})
			return
		}
		if metadata.ByteSize != claims.ByteSize || !hmac.Equal([]byte(metadata.CiphertextSHA256), []byte(claims.SHA256)) {
			writeJSON(w, http.StatusConflict, map[string]string{"code": "upload_mismatch"})
			return
		}
		attachment, err := s.repository.FinalizeAgentAttachment(r.Context(), userID, jobID, attachmentID,
			hashAgentUploadToken(body.UploadToken), metadata.ByteSize, metadata.CiphertextSHA256)
		if err != nil {
			writeAgentAttachmentError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, attachment)
	}
}

// UploadContent relays encrypted bytes through misty-server so desktop clients
// do not require browser CORS access to the private object-store bucket. The
// server validates the signed grant and ciphertext digest but never receives
// the unwrapped document key or plaintext.
func (s *AgentAttachmentsService) UploadContent() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		jobID, attachmentID := chi.URLParam(r, "jobID"), chi.URLParam(r, "attachmentID")
		uploadToken := strings.TrimSpace(r.Header.Get(agentAttachmentUploadTokenHeader))
		claims, err := s.verifyUploadClaims(uploadToken)
		if !jobIDPattern.MatchString(jobID) || !attachmentIDPattern.MatchString(attachmentID) || err != nil ||
			claims.JobID != jobID || claims.AttachmentID != attachmentID || claims.ExpiresAt < s.now().Unix() {
			writeJSON(w, http.StatusForbidden, map[string]string{"code": "invalid_upload_token"})
			return
		}
		attachment, err := s.repository.AgentAttachment(r.Context(), userID, jobID, attachmentID)
		if err != nil {
			writeAgentAttachmentError(w, err)
			return
		}
		if attachment.State != "initiated" || attachment.UploadTokenHash != hashAgentUploadToken(uploadToken) ||
			attachment.CiphertextByteSize != claims.ByteSize || attachment.CiphertextSHA256 != claims.SHA256 ||
			!attachment.UploadExpiresAt.After(s.now()) {
			writeJSON(w, http.StatusForbidden, map[string]string{"code": "invalid_upload_token"})
			return
		}
		if r.ContentLength != claims.ByteSize {
			writeJSON(w, http.StatusConflict, map[string]string{"code": "upload_mismatch"})
			return
		}
		hasher := sha256.New()
		body := io.TeeReader(http.MaxBytesReader(w, r.Body, claims.ByteSize), hasher)
		if err := s.store.Put(r.Context(), claims.StorageKey, body, claims.ByteSize, attachment.MediaType, claims.SHA256); err != nil {
			http.Error(w, "object store unavailable", http.StatusServiceUnavailable)
			return
		}
		if hex.EncodeToString(hasher.Sum(nil)) != claims.SHA256 {
			_ = s.store.Delete(r.Context(), claims.StorageKey)
			writeJSON(w, http.StatusConflict, map[string]string{"code": "upload_mismatch"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *AgentAttachmentsService) DeleteAttachment() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		jobID, attachmentID := chi.URLParam(r, "jobID"), chi.URLParam(r, "attachmentID")
		if !jobIDPattern.MatchString(jobID) || !attachmentIDPattern.MatchString(attachmentID) {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		attachment, err := s.repository.AgentAttachment(r.Context(), userID, jobID, attachmentID)
		if err != nil {
			writeAgentAttachmentError(w, err)
			return
		}
		if err := s.store.Delete(r.Context(), attachment.StorageKey); err != nil && !errors.Is(err, ErrAgentObjectNotFound) {
			http.Error(w, "object store unavailable", http.StatusServiceUnavailable)
			return
		}
		if _, err := s.repository.DeleteAgentAttachment(r.Context(), userID, jobID, attachmentID); err != nil {
			writeAgentAttachmentError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// PurgeExpired removes ciphertext before erasing its wrapped key. It is safe to
// call repeatedly from a scheduler; both object deletion and DB marking are
// idempotent. No public route should expose this service-level operation.
func (s *AgentAttachmentsService) PurgeExpired(ctx context.Context, limit int) (int, error) {
	attachments, err := s.repository.ExpiredAgentAttachments(ctx, s.now(), limit)
	if err != nil {
		return 0, err
	}
	purged := 0
	for _, attachment := range attachments {
		if err := s.store.Delete(ctx, attachment.StorageKey); err != nil && !errors.Is(err, ErrAgentObjectNotFound) {
			continue
		}
		if err := s.repository.MarkAgentAttachmentPurged(ctx, attachment.ID); err != nil {
			continue
		}
		purged++
	}
	return purged, nil
}

func (s *AgentAttachmentsService) requireUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID, err := s.authenticate(r)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return "", false
	}
	if strings.TrimSpace(userID) == "" {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return "", false
	}
	return userID, true
}

type agentUploadClaims struct {
	Version      int    `json:"v"`
	AttachmentID string `json:"a"`
	JobID        string `json:"j"`
	StorageKey   string `json:"k"`
	ByteSize     int64  `json:"b"`
	SHA256       string `json:"s"`
	ExpiresAt    int64  `json:"e"`
	Nonce        string `json:"n"`
}

func (s *AgentAttachmentsService) signUploadClaims(claims agentUploadClaims) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, s.signingKey)
	_, _ = mac.Write([]byte(encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (s *AgentAttachmentsService) verifyUploadClaims(token string) (agentUploadClaims, error) {
	var claims agentUploadClaims
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return claims, db.ErrAgentAttachmentToken
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return claims, db.ErrAgentAttachmentToken
	}
	mac := hmac.New(sha256.New, s.signingKey)
	_, _ = mac.Write([]byte(parts[0]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return claims, db.ErrAgentAttachmentToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(payload, &claims) != nil || claims.Version != 1 || claims.Nonce == "" {
		return agentUploadClaims{}, db.ErrAgentAttachmentToken
	}
	return claims, nil
}

func hashAgentUploadToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func validAgentAttachmentName(name string) bool {
	name = strings.TrimSpace(name)
	if !validText(name, 1, 255) || filepath.Base(name) != name || strings.ContainsAny(name, `/\\`) {
		return false
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f || r == utf8.RuneError {
			return false
		}
	}
	return true
}

func validAgentAttachmentMediaType(value string) bool {
	if !validAgentAttachmentMetadata(value, 255) {
		return false
	}
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(value))
	return err == nil && strings.Contains(mediaType, "/")
}

func validAgentAttachmentMetadata(value string, max int) bool {
	if !validText(value, 1, max) {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f || r == utf8.RuneError {
			return false
		}
	}
	return true
}

func validWrappedDataKey(value string) bool {
	if len(value) < 16 || len(value) > 8192 {
		return false
	}
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.RawURLEncoding} {
		decoded, err := encoding.DecodeString(value)
		if err == nil {
			return len(decoded) >= 16 && len(decoded) <= 4096
		}
	}
	return false
}

func writeAgentAttachmentError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrAgentAttachmentNotFound), errors.Is(err, db.ErrAgentJobNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, db.ErrAgentCloudConsent):
		writeJSON(w, http.StatusForbidden, map[string]string{"code": "cloud_document_consent_required"})
	case errors.Is(err, db.ErrAgentAttachmentLimit):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"code": "attachment_limit_exceeded"})
	case errors.Is(err, db.ErrAgentDocumentPageLimit):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"code": "document_page_limit_exceeded"})
	case errors.Is(err, db.ErrAgentAttachmentEnvelope):
		writeJSON(w, http.StatusConflict, map[string]string{"code": "job_encryption_envelope_mismatch"})
	case errors.Is(err, db.ErrAgentAttachmentExpired):
		writeJSON(w, http.StatusGone, map[string]string{"code": "attachment_expired"})
	case errors.Is(err, db.ErrAgentAttachmentToken):
		writeJSON(w, http.StatusForbidden, map[string]string{"code": "invalid_upload_token"})
	default:
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
}
