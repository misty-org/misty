package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestS3AgentAttachmentStorePresignsConstrainedR2Upload(t *testing.T) {
	store, _ := testS3AgentAttachmentStore(t, nil)
	payload := []byte("encrypted attachment payload")
	digestBytes := sha256.Sum256(payload)
	digest := hex.EncodeToString(digestBytes[:])
	expiresAt := time.Now().Add(10 * time.Minute).UTC()

	upload, err := store.PresignPut(context.Background(), "agents/job-id/attachment-id", int64(len(payload)), "application/octet-stream", digest, expiresAt)
	if err != nil {
		t.Fatalf("PresignPut() error = %v", err)
	}
	parsed, err := url.Parse(upload.URL)
	if err != nil {
		t.Fatalf("parse upload URL: %v", err)
	}
	signedHeaders := parsed.Query().Get("X-Amz-SignedHeaders")
	if parsed.Query().Get("X-Amz-Signature") == "" || !strings.Contains(signedHeaders, "content-length") || !strings.Contains(signedHeaders, "content-type") || !strings.Contains(signedHeaders, "x-amz-meta-misty-ciphertext-sha256") {
		t.Fatalf("upload URL is not SigV4-bound to ciphertext metadata: %s", upload.URL)
	}
	if got := parsed.Query().Get("X-Amz-Checksum-Sha256"); got != base64.StdEncoding.EncodeToString(digestBytes[:]) {
		t.Fatalf("signed checksum query = %q, want ciphertext SHA-256: %s", got, upload.URL)
	}
	if upload.Method != http.MethodPut {
		t.Fatalf("upload method = %q, want PUT", upload.Method)
	}
	assertUploadHeader(t, upload.Headers, "Content-Type", "application/octet-stream")
	assertUploadHeader(t, upload.Headers, "Content-Length", strconv.Itoa(len(payload)))
	assertUploadHeader(t, upload.Headers, "X-Amz-Meta-Misty-Ciphertext-Sha256", digest)
}

func TestS3AgentAttachmentStoreHeadOpenAndDelete(t *testing.T) {
	payload := []byte("encrypted attachment payload")
	digestBytes := sha256.Sum256(payload)
	digest := hex.EncodeToString(digestBytes[:])
	var mu sync.Mutex
	methods := make([]string, 0, 4)
	store, server := testS3AgentAttachmentStore(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		methods = append(methods, r.Method)
		mu.Unlock()
		if r.URL.Path != "/private-bucket/agents/job-id/attachment-id" {
			http.NotFound(w, r)
			return
		}
		switch r.Method {
		case http.MethodPut:
			got, err := io.ReadAll(r.Body)
			if err != nil || string(got) != string(payload) || r.Header.Get("X-Amz-Meta-Misty-Ciphertext-Sha256") != digest {
				t.Errorf("PUT payload=%q digest=%q error=%v", got, r.Header.Get("X-Amz-Meta-Misty-Ciphertext-Sha256"), err)
			}
			w.WriteHeader(http.StatusNoContent)
		case http.MethodHead:
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			w.Header().Set("X-Amz-Meta-Misty-Ciphertext-Sha256", digest)
		case http.MethodGet:
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			w.Header().Set("X-Amz-Meta-Misty-Ciphertext-Sha256", digest)
			_, _ = w.Write(payload)
		case http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "unsupported", http.StatusMethodNotAllowed)
		}
	})
	defer server.Close()

	if err := store.Put(context.Background(), "agents/job-id/attachment-id", strings.NewReader(string(payload)), int64(len(payload)), "application/octet-stream", digest); err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	metadata, err := store.Head(context.Background(), "agents/job-id/attachment-id")
	if err != nil || metadata.ByteSize != int64(len(payload)) || metadata.CiphertextSHA256 != digest {
		t.Fatalf("Head() = %#v, %v", metadata, err)
	}
	body, openedMetadata, err := store.Open(context.Background(), "agents/job-id/attachment-id")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	got, readErr := io.ReadAll(body)
	closeErr := body.Close()
	if readErr != nil || closeErr != nil || string(got) != string(payload) || openedMetadata != metadata {
		t.Fatalf("Open() payload=%q metadata=%#v readErr=%v closeErr=%v", got, openedMetadata, readErr, closeErr)
	}
	if err := store.Delete(context.Background(), "agents/job-id/attachment-id"); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if strings.Join(methods, ",") != "PUT,HEAD,GET,DELETE" {
		t.Fatalf("methods = %v", methods)
	}
}

func TestS3AgentAttachmentStoreRejectsUnsafeProductionConfig(t *testing.T) {
	base := S3AgentAttachmentStoreConfig{
		Endpoint: "https://account.r2.cloudflarestorage.com", Region: "auto", Bucket: "private-bucket",
		AccessKeyID: "access", SecretAccessKey: "secret", BucketPrivate: true, LifecycleMaxDays: 2,
	}
	tests := []struct {
		name   string
		mutate func(*S3AgentAttachmentStoreConfig)
	}{
		{name: "public bucket", mutate: func(c *S3AgentAttachmentStoreConfig) { c.BucketPrivate = false }},
		{name: "missing lifecycle", mutate: func(c *S3AgentAttachmentStoreConfig) { c.LifecycleMaxDays = 0 }},
		{name: "overlong lifecycle", mutate: func(c *S3AgentAttachmentStoreConfig) { c.LifecycleMaxDays = 3 }},
		{name: "insecure endpoint", mutate: func(c *S3AgentAttachmentStoreConfig) { c.Endpoint = "http://r2.example.com" }},
		{name: "endpoint credentials", mutate: func(c *S3AgentAttachmentStoreConfig) { c.Endpoint = "https://user:secret@r2.example.com" }},
		{name: "bucket path", mutate: func(c *S3AgentAttachmentStoreConfig) { c.Bucket = "bucket/path" }},
		{name: "missing credentials", mutate: func(c *S3AgentAttachmentStoreConfig) { c.SecretAccessKey = "" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := base
			tt.mutate(&config)
			if _, err := NewS3AgentAttachmentStore(config); err == nil {
				t.Fatal("NewS3AgentAttachmentStore() succeeded")
			}
		})
	}
}

func testS3AgentAttachmentStore(t *testing.T, handler http.HandlerFunc) (*S3AgentAttachmentStore, *httptest.Server) {
	t.Helper()
	if handler == nil {
		handler = func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }
	}
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	store, err := NewS3AgentAttachmentStore(S3AgentAttachmentStoreConfig{
		Endpoint: server.URL, Region: "auto", Bucket: "private-bucket", AccessKeyID: "test-access-key",
		SecretAccessKey: "test-secret-key", ForcePathStyle: true, BucketPrivate: true, LifecycleMaxDays: 2,
		AllowInsecureLocal: true, HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("NewS3AgentAttachmentStore() error = %v", err)
	}
	return store, server
}

func assertUploadHeader(t *testing.T, headers map[string]string, name, want string) {
	t.Helper()
	for key, value := range headers {
		if strings.EqualFold(key, name) {
			if value != want {
				t.Fatalf("upload header %s = %q, want %q", name, value, want)
			}
			return
		}
	}
	t.Fatalf("upload header %s missing: %v", name, headers)
}
