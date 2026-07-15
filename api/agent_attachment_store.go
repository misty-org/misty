package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"
)

var ErrAgentObjectNotFound = errors.New("agent attachment object not found")

type AgentObjectUpload struct {
	URL       string            `json:"url"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers"`
	ExpiresAt time.Time         `json:"expiresAt"`
}

type AgentObjectMetadata struct {
	ByteSize         int64
	CiphertextSHA256 string
}

// AgentAttachmentStore is intentionally the small subset needed from an
// S3-compatible backend. Uploads are constrained to ObjectKey, ByteSize,
// MediaType and CiphertextSHA256, and Misty never gives this interface an
// unwrapped data key.
type AgentAttachmentStore interface {
	Put(ctx context.Context, objectKey string, body io.Reader, byteSize int64, mediaType, ciphertextSHA256 string) error
	Head(ctx context.Context, objectKey string) (AgentObjectMetadata, error)
	Open(ctx context.Context, objectKey string) (io.ReadCloser, AgentObjectMetadata, error)
	Delete(ctx context.Context, objectKey string) error
}

type memoryAgentObject struct {
	data     []byte
	metadata AgentObjectMetadata
}

// MemoryAgentAttachmentStore is a deterministic test/development backend. It
// deliberately stores only ciphertext; callers use PutCiphertext to emulate a
// signed PUT after receiving a memory:// upload URL.
type MemoryAgentAttachmentStore struct {
	mu      sync.RWMutex
	objects map[string]memoryAgentObject
	grants  map[string]AgentObjectMetadata
}

func NewMemoryAgentAttachmentStore() *MemoryAgentAttachmentStore {
	return &MemoryAgentAttachmentStore{objects: map[string]memoryAgentObject{}, grants: map[string]AgentObjectMetadata{}}
}

func (s *MemoryAgentAttachmentStore) PresignPut(_ context.Context, objectKey string, byteSize int64, mediaType, ciphertextSHA256 string, expiresAt time.Time) (AgentObjectUpload, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.grants[objectKey] = AgentObjectMetadata{ByteSize: byteSize, CiphertextSHA256: ciphertextSHA256}
	return AgentObjectUpload{
		URL:       "memory://" + objectKey,
		Method:    "PUT",
		Headers:   map[string]string{"Content-Type": mediaType, "X-Misty-Ciphertext-SHA256": ciphertextSHA256},
		ExpiresAt: expiresAt,
	}, nil
}

func (s *MemoryAgentAttachmentStore) PutCiphertext(objectKey string, ciphertext []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	grant, ok := s.grants[objectKey]
	if !ok {
		return ErrAgentObjectNotFound
	}
	sum := sha256.Sum256(ciphertext)
	actual := AgentObjectMetadata{ByteSize: int64(len(ciphertext)), CiphertextSHA256: hex.EncodeToString(sum[:])}
	if actual != grant {
		return fmt.Errorf("ciphertext does not match signed upload constraints")
	}
	s.objects[objectKey] = memoryAgentObject{data: append([]byte(nil), ciphertext...), metadata: actual}
	return nil
}

func (s *MemoryAgentAttachmentStore) Put(_ context.Context, objectKey string, body io.Reader, byteSize int64, _ string, ciphertextSHA256 string) error {
	ciphertext, err := io.ReadAll(io.LimitReader(body, byteSize+1))
	if err != nil {
		return err
	}
	if int64(len(ciphertext)) != byteSize {
		return errors.New("ciphertext byte size does not match upload grant")
	}
	sum := sha256.Sum256(ciphertext)
	actual := AgentObjectMetadata{ByteSize: int64(len(ciphertext)), CiphertextSHA256: hex.EncodeToString(sum[:])}
	if actual.ByteSize != byteSize || actual.CiphertextSHA256 != ciphertextSHA256 {
		return errors.New("ciphertext does not match upload constraints")
	}
	s.mu.Lock()
	s.objects[objectKey] = memoryAgentObject{data: append([]byte(nil), ciphertext...), metadata: actual}
	s.mu.Unlock()
	return nil
}

func (s *MemoryAgentAttachmentStore) Head(_ context.Context, objectKey string) (AgentObjectMetadata, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	object, ok := s.objects[objectKey]
	if !ok {
		return AgentObjectMetadata{}, ErrAgentObjectNotFound
	}
	return object.metadata, nil
}

func (s *MemoryAgentAttachmentStore) Open(_ context.Context, objectKey string) (io.ReadCloser, AgentObjectMetadata, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	object, ok := s.objects[objectKey]
	if !ok {
		return nil, AgentObjectMetadata{}, ErrAgentObjectNotFound
	}
	return io.NopCloser(bytes.NewReader(append([]byte(nil), object.data...))), object.metadata, nil
}

func (s *MemoryAgentAttachmentStore) Delete(_ context.Context, objectKey string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.objects, objectKey)
	delete(s.grants, objectKey)
	return nil
}
