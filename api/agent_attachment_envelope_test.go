package api

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"

	"github.com/kannachi323/misty/server/agent"
	"github.com/kannachi323/misty/server/db"
)

func TestEncryptedDocumentAttachmentHydratesOnlyForBoundScope(t *testing.T) {
	keyring, err := GenerateDevelopmentAgentAttachmentEnvelopeKeyring()
	if err != nil {
		t.Fatal(err)
	}
	dataKey := make([]byte, 32)
	if _, err := rand.Read(dataKey); err != nil {
		t.Fatal(err)
	}
	wrapped, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, &keyring.keys[keyring.currentID].PublicKey, dataKey, nil)
	if err != nil {
		t.Fatal(err)
	}
	documentID := "document_11111111111111111111111111111111"
	plaintext := []byte(`{"documentId":"document_11111111111111111111111111111111","fileName":"report.pdf","mimeType":"application/pdf","sizeBytes":100,"scopeId":"scope_abcdefgh","relativePath":"reports/report.pdf","sections":[{"kind":"page","locator":"1","text":"Grounded text","requiresOcr":false}],"truncated":false,"requiresOcr":false,"hasMore":false}`)
	ciphertext := sealTestAgentAttachment(t, dataKey, plaintext)
	digest := sha256.Sum256(ciphertext)
	digestHex := hex.EncodeToString(digest[:])
	store := NewMemoryAgentAttachmentStore()
	storageKey := "agents/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222"
	if _, err := store.PresignPut(context.Background(), storageKey, int64(len(ciphertext)), "application/vnd.misty.agent-document+json", digestHex, time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := store.PutCiphertext(storageKey, ciphertext); err != nil {
		t.Fatal(err)
	}
	repository := &fakeAgentAttachmentRepository{attachment: &db.AgentAttachment{
		ID: "attachment_22222222-2222-4222-8222-222222222222", JobID: "job_11111111-1111-4111-8111-111111111111", DocumentID: documentID,
		StorageKey: storageKey, State: "ready", PlaintextByteSize: int64(len(plaintext)), CiphertextByteSize: int64(len(ciphertext)),
		CiphertextSHA256: digestHex, WrappedDataKey: base64.StdEncoding.EncodeToString(wrapped), KeyWrapAlgorithm: "RSA-OAEP-SHA256",
		KeyWrapKeyID: keyring.currentID, ContentEncryption: "AES-256-GCM", ExpiresAt: time.Now().Add(time.Hour),
	}}
	service := testAgentAttachmentsService(repository, store)
	if err := service.SetEnvelopeKeyring(keyring); err != nil {
		t.Fatal(err)
	}
	result := agent.ToolResult{RequestID: "request", Name: agent.ToolPreviewFile, OK: true, Result: json.RawMessage(`{"attachmentId":"attachment_22222222-2222-4222-8222-222222222222","scopeId":"scope_abcdefgh","relativePath":"reports/report.pdf"}`)}
	hydrated, err := service.HydrateDocumentToolResults(context.Background(), "user", repository.attachment.JobID, "scope_abcdefgh", []agent.ToolResult{result})
	if err != nil {
		t.Fatal(err)
	}
	if !json.Valid(hydrated[0].Result) || !bytes.Contains(hydrated[0].Result, []byte("Grounded text")) {
		t.Fatalf("unexpected hydrated result: %s", hydrated[0].Result)
	}
	if _, err := service.HydrateDocumentToolResults(context.Background(), "user", repository.attachment.JobID, "scope_other123", []agent.ToolResult{result}); err == nil {
		t.Fatal("attachment reference crossed its bound agent scope")
	}
}

func sealTestAgentAttachment(t *testing.T, key, plaintext []byte) []byte {
	t.Helper()
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, agentAttachmentNonceBytes)
	if _, err := rand.Read(nonce); err != nil {
		t.Fatal(err)
	}
	sealed := gcm.Seal(nil, nonce, plaintext, []byte(agentAttachmentCipherMagic))
	result := append([]byte(agentAttachmentCipherMagic), nonce...)
	return append(result, sealed...)
}
