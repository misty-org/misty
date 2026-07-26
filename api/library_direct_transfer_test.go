package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kannachi323/misty/server/db"
)

// stubPresigner records what the service asked to sign without contacting R2.
type stubPresigner struct {
	putKey, getKey   string
	putTTL, getTTL   time.Duration
	getFilename      string
	putMetadata      LibraryObjectMetadata
	presignPutCalled bool
}

func (p *stubPresigner) PresignPut(_ context.Context, key string, metadata LibraryObjectMetadata, ttl time.Duration) (PresignedTransfer, error) {
	p.presignPutCalled, p.putKey, p.putMetadata, p.putTTL = true, key, metadata, ttl
	return PresignedTransfer{
		URL:    "https://account.r2.cloudflarestorage.com/misty/" + key + "?X-Amz-Signature=abc",
		Method: http.MethodPut,
		Headers: map[string]string{
			"Content-Type":          metadata.MIMEType,
			"x-amz-checksum-sha256": "checksum",
		},
		ExpiresAt: time.Now().Add(ttl).UTC(),
	}, nil
}

func (p *stubPresigner) PresignGet(_ context.Context, key, filename string, ttl time.Duration) (PresignedDownload, error) {
	p.getKey, p.getFilename, p.getTTL = key, filename, ttl
	return PresignedDownload{
		URL:       "https://account.r2.cloudflarestorage.com/misty/" + key + "?X-Amz-Signature=def",
		ExpiresAt: time.Now().Add(ttl).UTC(),
		Filename:  filename,
	}, nil
}

func directTransferService(t *testing.T, presigner LibraryObjectPresigner) *SpaceLibraryService {
	t.Helper()
	return &SpaceLibraryService{
		store:        NewMemoryLibraryObjectStore(),
		uploadLimits: DefaultUploadLimits(),
		presigner:    presigner,
		transfers:    DirectTransferConfig{Enabled: true, UploadURLTTL: 15 * time.Minute, DownloadURLTTL: 2 * time.Minute},
	}
}

func TestUploadTransferReturnsAbsoluteSignedPutWithoutMistyCredentials(t *testing.T) {
	presigner := &stubPresigner{}
	service := directTransferService(t, presigner)
	digest := sha256.Sum256([]byte("direct upload fixture"))
	upload := &db.LibraryUpload{
		ID: "upload_1", SpaceID: "space_1", ObjectKey: "library/directfixture01",
		RequestedByteSize: 21, ClientSHA256: hex.EncodeToString(digest[:]), ClientDeclaredMIMEType: "text/plain",
	}

	transfer, err := service.uploadTransfer(context.Background(), upload, "misty-upload-token", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}

	if !presigner.presignPutCalled {
		t.Fatal("uploadTransfer() did not sign an R2 PUT")
	}
	if presigner.putKey != upload.ObjectKey {
		t.Fatalf("signed key = %q, want %q", presigner.putKey, upload.ObjectKey)
	}
	if presigner.putMetadata.ByteSize != upload.RequestedByteSize || presigner.putMetadata.SHA256 != upload.ClientSHA256 {
		t.Fatalf("signed metadata = %#v", presigner.putMetadata)
	}
	if presigner.putTTL != 15*time.Minute {
		t.Fatalf("upload TTL = %s, want 15m", presigner.putTTL)
	}
	// The absolute R2 URL must never carry a Misty upload token: the client
	// sends it with no cookies and no Misty authorization header.
	if _, leaked := transfer.Headers[libraryUploadTokenHeader]; leaked {
		t.Fatalf("signed transfer leaked the Misty upload token: %#v", transfer.Headers)
	}
	if transfer.URL[:8] != "https://" {
		t.Fatalf("URL = %q, want an absolute https URL", transfer.URL)
	}
}

func TestUploadTransferFallsBackToProxyWhenDirectTransferIsOff(t *testing.T) {
	service := &SpaceLibraryService{store: NewMemoryLibraryObjectStore(), uploadLimits: DefaultUploadLimits()}
	upload := &db.LibraryUpload{ID: "upload_1", SpaceID: "space_1", ObjectKey: "library/proxyfixture001", ClientDeclaredMIMEType: "text/plain"}

	transfer, err := service.uploadTransfer(context.Background(), upload, "misty-upload-token", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}

	if transfer.URL != "/spaces/space_1/library/uploads/upload_1/content" {
		t.Fatalf("URL = %q, want the relative proxy route", transfer.URL)
	}
	if transfer.Headers[libraryUploadTokenHeader] != "misty-upload-token" {
		t.Fatal("proxy transfer must carry the Misty upload token")
	}
}

func TestWriteDownloadReturnsSignedDescriptorInsteadOfBytes(t *testing.T) {
	presigner := &stubPresigner{}
	service := directTransferService(t, presigner)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/spaces/space_1/library/items/item_1/download", nil)
	download := &db.LibraryDownload{
		ObjectKey: "library/downloadfixture1", Filename: "quarterly report.pdf",
		MIMEType: "application/pdf", ByteSize: 4096, SHA256: "0",
	}

	service.writeDownload(recorder, request, download)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	var descriptor PresignedDownload
	if err := json.Unmarshal(recorder.Body.Bytes(), &descriptor); err != nil {
		t.Fatalf("response was not a signed descriptor: %v (%s)", err, recorder.Body.String())
	}
	if descriptor.URL == "" || descriptor.Filename != "quarterly report.pdf" {
		t.Fatalf("descriptor = %#v", descriptor)
	}
	if presigner.getKey != download.ObjectKey {
		t.Fatalf("signed key = %q, want %q", presigner.getKey, download.ObjectKey)
	}
	if presigner.getTTL != 2*time.Minute {
		t.Fatalf("download TTL = %s, want 2m", presigner.getTTL)
	}
	if descriptor.ExpiresAt.IsZero() || !descriptor.ExpiresAt.After(time.Now()) {
		t.Fatalf("ExpiresAt = %s, want a future expiry", descriptor.ExpiresAt)
	}
}

func TestEnableDirectTransfersRequiresASigningStore(t *testing.T) {
	// The in-memory development store cannot sign, so enabling direct transfer
	// must fail loudly rather than quietly proxying production uploads.
	service := &SpaceLibraryService{store: NewMemoryLibraryObjectStore(), uploadLimits: DefaultUploadLimits()}

	err := service.EnableDirectTransfers(DirectTransferConfig{Enabled: true, UploadURLTTL: 15 * time.Minute, DownloadURLTTL: 2 * time.Minute})
	if err == nil {
		t.Fatal("EnableDirectTransfers() accepted a store that cannot sign R2 operations")
	}
	if service.directTransfersActive() {
		t.Fatal("direct transfers became active despite the configuration error")
	}

	// Disabled configuration is always valid and keeps the proxy route.
	if err := service.EnableDirectTransfers(DirectTransferConfig{Enabled: false}); err != nil {
		t.Fatalf("EnableDirectTransfers(disabled) = %v", err)
	}
}

func TestEnableDirectTransfersRejectsUnboundedURLLifetimes(t *testing.T) {
	service := &SpaceLibraryService{store: &S3LibraryObjectStore{bucket: "misty", presigner: &recordingPresigner{}}, uploadLimits: DefaultUploadLimits()}

	err := service.EnableDirectTransfers(DirectTransferConfig{Enabled: true, UploadURLTTL: 48 * time.Hour, DownloadURLTTL: 2 * time.Minute})
	if err == nil {
		t.Fatal("EnableDirectTransfers() accepted a 48h upload URL lifetime")
	}
}
