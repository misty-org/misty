package api

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/kannachi323/misty/server/agent"
)

const (
	agentAttachmentCipherMagic = "MSTY1"
	agentAttachmentNonceBytes  = 12
	maxPreparedSections        = 200
	maxPreparedImagesPerBatch  = 8
)

var envelopeKeyIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

// AgentAttachmentEnvelopeKeyring keeps key-encryption keys outside the object
// store and database. Old keys can remain configured during a rotation; only
// the current public key is disclosed to an authenticated desktop client.
type AgentAttachmentEnvelopeKeyring struct {
	currentID string
	keys      map[string]*rsa.PrivateKey
}

func NewAgentAttachmentEnvelopeKeyring(currentID string, encodedPrivateKeys map[string]string) (*AgentAttachmentEnvelopeKeyring, error) {
	currentID = strings.TrimSpace(currentID)
	if !envelopeKeyIDPattern.MatchString(currentID) || len(encodedPrivateKeys) == 0 {
		return nil, errors.New("agent attachment envelope keyring is incomplete")
	}
	keyring := &AgentAttachmentEnvelopeKeyring{currentID: currentID, keys: make(map[string]*rsa.PrivateKey, len(encodedPrivateKeys))}
	for keyID, encoded := range encodedPrivateKeys {
		keyID = strings.TrimSpace(keyID)
		if !envelopeKeyIDPattern.MatchString(keyID) {
			return nil, fmt.Errorf("invalid agent attachment envelope key id %q", keyID)
		}
		key, err := parseAgentAttachmentPrivateKey(encoded)
		if err != nil {
			return nil, fmt.Errorf("parse agent attachment envelope key %q: %w", keyID, err)
		}
		if key.N.BitLen() < 2048 {
			return nil, fmt.Errorf("agent attachment envelope key %q must be at least 2048 bits", keyID)
		}
		keyring.keys[keyID] = key
	}
	if keyring.keys[currentID] == nil {
		return nil, errors.New("current agent attachment envelope key is not present in keyring")
	}
	return keyring, nil
}

func GenerateDevelopmentAgentAttachmentEnvelopeKeyring() (*AgentAttachmentEnvelopeKeyring, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	return &AgentAttachmentEnvelopeKeyring{currentID: "development-ephemeral", keys: map[string]*rsa.PrivateKey{"development-ephemeral": key}}, nil
}

func parseAgentAttachmentPrivateKey(encoded string) (*rsa.PrivateKey, error) {
	encoded = strings.TrimSpace(encoded)
	if decoded, err := base64.StdEncoding.DecodeString(encoded); err == nil {
		encoded = string(decoded)
	}
	block, _ := pem.Decode([]byte(encoded))
	if block == nil {
		return nil, errors.New("expected a PEM or base64-encoded PEM private key")
	}
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		if rsaKey, ok := key.(*rsa.PrivateKey); ok {
			return rsaKey, rsaKey.Validate()
		}
	}
	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("expected an RSA PKCS#8 or PKCS#1 private key")
	}
	return key, key.Validate()
}

func (k *AgentAttachmentEnvelopeKeyring) publicEnvelope() (map[string]string, error) {
	key := k.keys[k.currentID]
	encoded, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return nil, err
	}
	return map[string]string{
		"keyId":            k.currentID,
		"keyWrapAlgorithm": "RSA-OAEP-SHA256",
		"publicKey":        base64.StdEncoding.EncodeToString(encoded),
	}, nil
}

func (k *AgentAttachmentEnvelopeKeyring) unwrap(keyID, encoded string) ([]byte, error) {
	key := k.keys[strings.TrimSpace(keyID)]
	if key == nil {
		return nil, errors.New("agent attachment envelope key is unavailable")
	}
	wrapped, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, errors.New("agent attachment wrapped key is invalid")
	}
	plaintext, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, key, wrapped, nil)
	if err != nil || len(plaintext) != 32 {
		return nil, errors.New("agent attachment wrapped key could not be decrypted")
	}
	return plaintext, nil
}

func decryptAgentAttachmentPayload(dataKey, ciphertext []byte) ([]byte, error) {
	if len(ciphertext) < len(agentAttachmentCipherMagic)+agentAttachmentNonceBytes+16 || string(ciphertext[:len(agentAttachmentCipherMagic)]) != agentAttachmentCipherMagic {
		return nil, errors.New("agent attachment ciphertext format is invalid")
	}
	block, err := aes.NewCipher(dataKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceStart := len(agentAttachmentCipherMagic)
	nonceEnd := nonceStart + agentAttachmentNonceBytes
	plaintext, err := gcm.Open(nil, ciphertext[nonceStart:nonceEnd], ciphertext[nonceEnd:], []byte(agentAttachmentCipherMagic))
	if err != nil {
		return nil, errors.New("agent attachment authentication failed")
	}
	return plaintext, nil
}

func (s *AgentAttachmentsService) SetEnvelopeKeyring(keyring *AgentAttachmentEnvelopeKeyring) error {
	if keyring == nil || keyring.keys[keyring.currentID] == nil {
		return errors.New("agent attachment envelope keyring is required")
	}
	s.envelopeKeys = keyring
	return nil
}

func (s *AgentAttachmentsService) Envelope() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := s.requireUser(w, r); !ok {
			return
		}
		if s.envelopeKeys == nil {
			http.Error(w, "attachment encryption unavailable", http.StatusServiceUnavailable)
			return
		}
		result, err := s.envelopeKeys.publicEnvelope()
		if err != nil {
			http.Error(w, "attachment encryption unavailable", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}

type encryptedDocumentReference struct {
	AttachmentID string `json:"attachmentId"`
	ScopeID      string `json:"scopeId"`
	RelativePath string `json:"relativePath"`
}

type hydratedPreparedDocument struct {
	DocumentID   string `json:"documentId"`
	FileName     string `json:"fileName"`
	MimeType     string `json:"mimeType"`
	SizeBytes    int64  `json:"sizeBytes"`
	ScopeID      string `json:"scopeId"`
	RelativePath string `json:"relativePath"`
	Sections     []struct {
		Kind         string `json:"kind"`
		Locator      string `json:"locator"`
		Text         string `json:"text"`
		ImageDataURL string `json:"imageDataUrl,omitempty"`
		RequiresOCR  bool   `json:"requiresOcr"`
	} `json:"sections"`
	Truncated    bool   `json:"truncated"`
	RequiresOCR  bool   `json:"requiresOcr"`
	NextCursor   string `json:"nextCursor,omitempty"`
	HasMore      bool   `json:"hasMore"`
	CitationRule string `json:"citationRule"`
}

// HydrateDocumentToolResults replaces opaque attachment references with
// authenticated plaintext immediately before the model call. Neither the
// ciphertext nor extracted document text is persisted in the 30-day session.
func (s *AgentAttachmentsService) HydrateDocumentToolResults(ctx context.Context, userID, jobID, allowedScope string, results []agent.ToolResult) ([]agent.ToolResult, error) {
	if s.envelopeKeys == nil {
		return nil, errors.New("attachment encryption unavailable")
	}
	hydrated := append([]agent.ToolResult(nil), results...)
	for index := range hydrated {
		if hydrated[index].Name != agent.ToolPreviewFile || !hydrated[index].OK {
			continue
		}
		var reference encryptedDocumentReference
		if json.Unmarshal(hydrated[index].Result, &reference) != nil || !attachmentIDPattern.MatchString(reference.AttachmentID) || reference.ScopeID != allowedScope || !validAgentRelativePath(reference.RelativePath) {
			return nil, errors.New("document tool result must use a scoped encrypted attachment")
		}
		attachment, err := s.repository.AgentAttachment(ctx, userID, jobID, reference.AttachmentID)
		if err != nil {
			return nil, err
		}
		if attachment.State != "ready" || !attachment.ExpiresAt.After(s.now()) || attachment.KeyWrapAlgorithm != "RSA-OAEP-SHA256" || attachment.ContentEncryption != "AES-256-GCM" {
			return nil, errors.New("agent attachment is not ready")
		}
		reader, metadata, err := s.store.Open(ctx, attachment.StorageKey)
		if err != nil {
			return nil, err
		}
		limit := attachment.CiphertextByteSize + 1
		ciphertext, readErr := io.ReadAll(io.LimitReader(reader, limit))
		closeErr := reader.Close()
		if readErr != nil || closeErr != nil || int64(len(ciphertext)) != attachment.CiphertextByteSize || metadata.ByteSize != attachment.CiphertextByteSize {
			return nil, errors.New("agent attachment object size mismatch")
		}
		digest := sha256.Sum256(ciphertext)
		if hex.EncodeToString(digest[:]) != attachment.CiphertextSHA256 || metadata.CiphertextSHA256 != attachment.CiphertextSHA256 {
			return nil, errors.New("agent attachment object digest mismatch")
		}
		dataKey, err := s.envelopeKeys.unwrap(attachment.KeyWrapKeyID, attachment.WrappedDataKey)
		if err != nil {
			return nil, err
		}
		plaintext, err := decryptAgentAttachmentPayload(dataKey, ciphertext)
		clear(dataKey)
		if err != nil || int64(len(plaintext)) != attachment.PlaintextByteSize {
			return nil, errors.New("agent attachment plaintext is invalid")
		}
		var document hydratedPreparedDocument
		if json.Unmarshal(plaintext, &document) != nil || !validHydratedPreparedDocument(document, reference, attachment.DocumentID) {
			clear(plaintext)
			return nil, errors.New("agent attachment document payload is invalid")
		}
		clear(plaintext)
		document.CitationRule = "Cite every factual document claim using scopeId, relativePath, fileName, section kind, and locator. If hasMore is true, request preview_file again with nextCursor before claiming the whole document was reviewed."
		hydrated[index].Result, _ = json.Marshal(document)
	}
	return hydrated, nil
}

func validHydratedPreparedDocument(document hydratedPreparedDocument, reference encryptedDocumentReference, expectedDocumentID string) bool {
	if document.ScopeID != reference.ScopeID || document.RelativePath != reference.RelativePath || document.FileName == "" || document.DocumentID != expectedDocumentID || !documentIDPattern.MatchString(document.DocumentID) || document.SizeBytes < 1 || len(document.Sections) == 0 || len(document.Sections) > maxPreparedSections {
		return false
	}
	if strings.Contains(document.FileName, "/") || strings.Contains(document.FileName, "\\") || !validAgentRelativePath(document.RelativePath) {
		return false
	}
	images := 0
	textBytes := 0
	for _, section := range document.Sections {
		if section.Kind == "" || section.Locator == "" || len(section.Locator) > 512 {
			return false
		}
		textBytes += len(section.Text)
		if textBytes > 512<<10 {
			return false
		}
		if section.ImageDataURL != "" {
			images++
			if images > maxPreparedImagesPerBatch || !strings.HasPrefix(section.ImageDataURL, "data:image/jpeg;base64,") || len(section.ImageDataURL) > 6<<20 {
				return false
			}
		}
	}
	return true
}
