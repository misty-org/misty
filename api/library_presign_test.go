package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/kannachi323/misty/server/db"
)

type recordingPresigner struct {
	putInput *s3.PutObjectInput
	getInput *s3.GetObjectInput
}

func (p *recordingPresigner) PresignPutObject(_ context.Context, input *s3.PutObjectInput, _ ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
	p.putInput = input
	return &v4.PresignedHTTPRequest{URL: "https://r2.example/signed-put", Method: http.MethodPut}, nil
}

func (p *recordingPresigner) PresignGetObject(_ context.Context, input *s3.GetObjectInput, _ ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
	p.getInput = input
	return &v4.PresignedHTTPRequest{URL: "https://r2.example/signed-get", Method: http.MethodGet}, nil
}

func testObjectMetadata(t *testing.T) LibraryObjectMetadata {
	t.Helper()
	digest := sha256.Sum256([]byte("presign fixture"))
	return LibraryObjectMetadata{ByteSize: 15, SHA256: hex.EncodeToString(digest[:]), MIMEType: "text/plain"}
}

func TestPresignPutBindsKeySizeAndChecksum(t *testing.T) {
	presigner := &recordingPresigner{}
	store := &S3LibraryObjectStore{bucket: "misty", presigner: presigner}
	metadata := testObjectMetadata(t)

	transfer, err := store.PresignPut(context.Background(), "library/presignfixture1", metadata, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	if transfer.URL != "https://r2.example/signed-put" || transfer.Method != http.MethodPut {
		t.Fatalf("PresignPut() = %#v", transfer)
	}
	if aws.ToString(presigner.putInput.Key) != "library/presignfixture1" {
		t.Fatalf("signed key = %q", aws.ToString(presigner.putInput.Key))
	}
	if aws.ToInt64(presigner.putInput.ContentLength) != metadata.ByteSize {
		t.Fatalf("signed length = %d, want %d", aws.ToInt64(presigner.putInput.ContentLength), metadata.ByteSize)
	}
	checksum, _ := hex.DecodeString(metadata.SHA256)
	wantChecksum := base64.StdEncoding.EncodeToString(checksum)
	if aws.ToString(presigner.putInput.ChecksumSHA256) != wantChecksum {
		t.Fatalf("signed checksum = %q, want %q", aws.ToString(presigner.putInput.ChecksumSHA256), wantChecksum)
	}
	// The client must be told exactly the headers the signature covers.
	if transfer.Headers["Content-Type"] != metadata.MIMEType ||
		transfer.Headers["x-amz-checksum-sha256"] != wantChecksum ||
		transfer.Headers["x-amz-meta-"+librarySHA256MetadataKey] != metadata.SHA256 {
		t.Fatalf("headers = %#v", transfer.Headers)
	}
	if len(transfer.Headers) != 3 {
		t.Fatalf("unexpected extra signed headers: %#v", transfer.Headers)
	}
	if !transfer.ExpiresAt.After(time.Now()) {
		t.Fatalf("ExpiresAt = %s, want future", transfer.ExpiresAt)
	}
}

func TestPresignRejectsBadKeyAndTTL(t *testing.T) {
	store := &S3LibraryObjectStore{bucket: "misty", presigner: &recordingPresigner{}}
	metadata := testObjectMetadata(t)

	if _, err := store.PresignPut(context.Background(), "../etc/passwd", metadata, time.Minute); err == nil {
		t.Fatal("PresignPut() accepted a key outside the permanent prefix")
	}
	if _, err := store.PresignGet(context.Background(), "notes/secret", "a.txt", time.Minute); err == nil {
		t.Fatal("PresignGet() accepted a key outside the permanent prefix")
	}
	if _, err := store.PresignPut(context.Background(), "library/presignfixture1", metadata, 24*time.Hour); err == nil {
		t.Fatal("PresignPut() accepted an out-of-range TTL")
	}
	if _, err := store.PresignGet(context.Background(), "library/presignfixture1", "a.txt", time.Second); err == nil {
		t.Fatal("PresignGet() accepted an out-of-range TTL")
	}
}

func TestPresignGetForcesSafeAttachmentDisposition(t *testing.T) {
	presigner := &recordingPresigner{}
	store := &S3LibraryObjectStore{bucket: "misty", presigner: presigner}

	download, err := store.PresignGet(context.Background(), "library/presignfixture1", "../../report\r\n.pdf", 2*time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	disposition := aws.ToString(presigner.getInput.ResponseContentDisposition)
	if !strings.HasPrefix(disposition, "attachment;") {
		t.Fatalf("disposition = %q, want attachment", disposition)
	}
	if strings.ContainsAny(disposition, "\r\n") || strings.Contains(disposition, "..") {
		t.Fatalf("disposition leaked path or newline: %q", disposition)
	}
	if download.Filename != "report.pdf" {
		t.Fatalf("Filename = %q, want report.pdf", download.Filename)
	}
}

func TestUploadLimitsAreEnforcedPerPurpose(t *testing.T) {
	limits := DefaultUploadLimits()

	if limits.Max(UploadPurposeLibrary) != 100<<20 {
		t.Fatalf("library limit = %d, want 100MB", limits.Max(UploadPurposeLibrary))
	}
	if limits.Max(UploadPurposeNoteAttachment) != 15<<20 {
		t.Fatalf("note limit = %d, want 15MB", limits.Max(UploadPurposeNoteAttachment))
	}
	if limits.Max(UploadPurposeChatAttachment) != 10<<20 {
		t.Fatalf("chat limit = %d, want 10MB", limits.Max(UploadPurposeChatAttachment))
	}
	// An unknown purpose must be rejected, not silently given a default.
	if limits.Max("avatar") != 0 {
		t.Fatalf("unknown purpose limit = %d, want 0", limits.Max("avatar"))
	}
}

func TestUploadLimitsRejectValuesAboveDatabaseCeiling(t *testing.T) {
	limits := DefaultUploadLimits()
	limits.ChatAttachment = db.DefaultChatAttachmentMaxFileBytes + 1

	if err := limits.validate(); err == nil {
		t.Fatal("validate() accepted a chat limit above the database ceiling")
	}

	limits = DefaultUploadLimits()
	limits.Library = 0
	if err := limits.validate(); err == nil {
		t.Fatal("validate() accepted a zero Library limit")
	}
}

func TestUploadPurposeEnabledRejectsNoteAssetsOnGenericEndpoint(t *testing.T) {
	service := &SpaceLibraryService{uploadsEnabled: true, attachmentsEnabled: true, noteAssetsEnabled: true}

	// Note assets authorize against the parent note, so the Space-wide Library
	// upload endpoint must never accept them even when the feature is on.
	if service.uploadPurposeEnabled(UploadPurposeNoteAttachment) {
		t.Fatal("generic Library upload endpoint accepted the note_attachment purpose")
	}
	if !service.uploadPurposeEnabled(UploadPurposeLibrary) || !service.uploadPurposeEnabled(UploadPurposeChatAttachment) {
		t.Fatal("library and chat attachment purposes should be enabled")
	}
	if service.uploadPurposeEnabled("avatar") {
		t.Fatal("unknown purpose accepted")
	}
}
