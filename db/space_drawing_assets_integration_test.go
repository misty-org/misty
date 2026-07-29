package db

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func createDrawingAssetUpload(
	t *testing.T,
	fixture noteFixture,
	userID, drawingID, fileID string,
	byteSize int64,
) (*LibraryUpload, error) {
	t.Helper()
	return fixture.database.CreateDrawingAssetUpload(
		fixture.ctx,
		userID,
		drawingID,
		fileID,
		fileID+".png",
		"image/png",
		byteSize,
		strings.Repeat("a", 64),
		"library/drawingasset"+fileID,
		"drawing-token-"+fileID,
		time.Now().Add(time.Hour),
	)
}

func TestDrawingAssetUploadAuthorizationAndBinding(t *testing.T) {
	fixture := newNoteFixture(t, "drawing-assets-auth")
	drawing, err := fixture.database.CreateSpaceDrawing(
		fixture.ctx,
		fixture.creator,
		fixture.spaceID,
		"Asset drawing",
	)
	if err != nil {
		t.Fatal(err)
	}

	upload, err := createDrawingAssetUpload(
		t, fixture, fixture.member, drawing.ID, "filemember", 1024,
	)
	if err != nil {
		t.Fatal(err)
	}
	var drawingID, drawingFileID, purpose string
	if err := fixture.database.Conn.QueryRow(
		`SELECT COALESCE(drawing_id,''),COALESCE(drawing_file_id,''),purpose
		 FROM space_library_uploads WHERE id=$1`,
		upload.ID,
	).Scan(&drawingID, &drawingFileID, &purpose); err != nil {
		t.Fatal(err)
	}
	if drawingID != drawing.ID ||
		drawingFileID != "filemember" ||
		purpose != UploadPurposeDrawingAsset {
		t.Fatalf(
			"binding = drawing:%q file:%q purpose:%q",
			drawingID, drawingFileID, purpose,
		)
	}

	outsider, err := fixture.database.CreateUser(
		"Drawing Asset Outsider",
		"drawing-assets-outsider@example.com",
		"password123",
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := createDrawingAssetUpload(
		t, fixture, outsider.ID, drawing.ID, "fileoutsider", 1024,
	); !errors.Is(err, ErrLibraryNotFound) {
		t.Fatalf("outsider upload error = %v, want ErrLibraryNotFound", err)
	}
	if _, err := createDrawingAssetUpload(
		t, fixture, fixture.creator, drawing.ID, "filelarge",
		DefaultDrawingAssetMaxFileBytes+1,
	); !errors.Is(err, ErrLibraryInvalid) {
		t.Fatalf("oversized upload error = %v, want ErrLibraryInvalid", err)
	}
}

func TestDrawingAssetFinalizationCreatesAuthorizedReference(t *testing.T) {
	fixture := newNoteFixture(t, "drawing-assets-finalize")
	drawing, err := fixture.database.CreateSpaceDrawing(
		fixture.ctx,
		fixture.creator,
		fixture.spaceID,
		"Finalized asset drawing",
	)
	if err != nil {
		t.Fatal(err)
	}
	const (
		excalidrawFileID = "filefinalized"
		tokenHash        = "drawing-token-filefinalized"
		byteSize         = int64(2048)
	)
	upload, err := createDrawingAssetUpload(
		t, fixture, fixture.creator, drawing.ID, excalidrawFileID, byteSize,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.database.SetLibraryUploadState(
		fixture.ctx,
		fixture.creator,
		fixture.spaceID,
		upload.ID,
		tokenHash,
		"initiated",
		"uploaded_unverified",
	); err != nil {
		t.Fatal(err)
	}
	completed, err := fixture.database.CompleteLibraryUpload(
		fixture.ctx,
		fixture.creator,
		fixture.spaceID,
		upload.ID,
		tokenHash,
		byteSize,
		strings.Repeat("a", 64),
		"image/png",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if completed.DrawingAsset == nil ||
		completed.DrawingAsset.DrawingID != drawing.ID ||
		completed.DrawingAsset.ExcalidrawFileID != excalidrawFileID {
		t.Fatalf("completed drawing asset = %#v", completed.DrawingAsset)
	}
	var scanStatus string
	if err := fixture.database.Conn.QueryRow(
		`SELECT scan_status FROM library_blobs WHERE id=$1`,
		completed.File.BlobID,
	).Scan(&scanStatus); err != nil {
		t.Fatal(err)
	}
	if scanStatus != "skipped" {
		t.Fatalf("drawing asset scan status = %q, want skipped", scanStatus)
	}

	assets, err := fixture.database.DrawingAssets(
		fixture.ctx,
		fixture.member,
		drawing.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(assets) != 1 ||
		assets[0].ID != completed.DrawingAsset.ID ||
		assets[0].SHA256 != strings.Repeat("a", 64) {
		t.Fatalf("assets = %#v", assets)
	}
	download, err := fixture.database.DrawingAssetDownload(
		fixture.ctx,
		fixture.member,
		drawing.ID,
		completed.DrawingAsset.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if download.ByteSize != byteSize || download.MIMEType != "image/png" {
		t.Fatalf("download = %#v", download)
	}
}

func finalizeDrawingAssetForCleanup(
	t *testing.T,
	fixture noteFixture,
	drawingID, excalidrawFileID string,
	byteSize int64,
) *CompleteLibraryUploadResult {
	t.Helper()
	tokenHash := "drawing-token-" + excalidrawFileID
	upload, err := createDrawingAssetUpload(
		t, fixture, fixture.creator, drawingID, excalidrawFileID, byteSize,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.database.SetLibraryUploadState(
		fixture.ctx, fixture.creator, fixture.spaceID, upload.ID, tokenHash,
		"initiated", "uploaded_unverified",
	); err != nil {
		t.Fatal(err)
	}
	completed, err := fixture.database.CompleteLibraryUpload(
		fixture.ctx, fixture.creator, fixture.spaceID, upload.ID, tokenHash,
		byteSize, strings.Repeat("a", 64), "image/png", nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	return completed
}

func TestJournalAssetCleanupPreservesSharedBlobUntilLastReference(t *testing.T) {
	fixture := newNoteFixture(t, "drawing-assets-cleanup")
	drawing, err := fixture.database.CreateSpaceDrawing(
		fixture.ctx, fixture.creator, fixture.spaceID, "Cleanup drawing",
	)
	if err != nil {
		t.Fatal(err)
	}
	const byteSize = int64(4096)
	first := finalizeDrawingAssetForCleanup(
		t, fixture, drawing.ID, "cleanup-file-one", byteSize,
	)
	second := finalizeDrawingAssetForCleanup(
		t, fixture, drawing.ID, "cleanup-file-two", byteSize,
	)
	if first.DrawingAsset == nil || second.DrawingAsset == nil {
		t.Fatalf("missing finalized assets: first=%#v second=%#v", first, second)
	}
	if first.File.BlobID != second.File.BlobID {
		t.Fatalf(
			"deduplicated assets used different blobs: %s != %s",
			first.File.BlobID, second.File.BlobID,
		)
	}

	if err := fixture.database.DeleteDrawingAsset(
		fixture.ctx, fixture.creator, drawing.ID, first.DrawingAsset.ID,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.database.Conn.ExecContext(
		fixture.ctx,
		`UPDATE space_drawing_assets SET deleted_at=NOW()-INTERVAL '25 hours'
		 WHERE id=$1`,
		first.DrawingAsset.ID,
	); err != nil {
		t.Fatal(err)
	}
	claims, err := fixture.database.ClaimExpiredJournalAssets(
		fixture.ctx, 24*time.Hour, 10,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(claims) != 1 || claims[0].DeleteBlob {
		t.Fatalf("first cleanup claims = %#v, want one shared-blob claim", claims)
	}
	if err := fixture.database.CompleteJournalAssetPurge(
		fixture.ctx, claims[0],
	); err != nil {
		t.Fatal(err)
	}
	var firstState, blobState string
	if err := fixture.database.Conn.QueryRowContext(
		fixture.ctx,
		`SELECT a.lifecycle_state,b.lifecycle_state
		 FROM space_drawing_assets a
		 JOIN library_files f ON f.id=a.file_id
		 JOIN library_blobs b ON b.id=f.blob_id
		 WHERE a.id=$1`,
		first.DrawingAsset.ID,
	).Scan(&firstState, &blobState); err != nil {
		t.Fatal(err)
	}
	if firstState != "deleted" || blobState != "ready" {
		t.Fatalf("first asset state=%q blob state=%q", firstState, blobState)
	}

	if err := fixture.database.DeleteDrawingAsset(
		fixture.ctx, fixture.creator, drawing.ID, second.DrawingAsset.ID,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.database.Conn.ExecContext(
		fixture.ctx,
		`UPDATE space_drawing_assets SET deleted_at=NOW()-INTERVAL '25 hours'
		 WHERE id=$1`,
		second.DrawingAsset.ID,
	); err != nil {
		t.Fatal(err)
	}
	claims, err = fixture.database.ClaimExpiredJournalAssets(
		fixture.ctx, 24*time.Hour, 10,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(claims) != 1 || !claims[0].DeleteBlob ||
		claims[0].ObjectKey == "" {
		t.Fatalf("last cleanup claims = %#v, want R2 object deletion", claims)
	}
	if err := fixture.database.CompleteJournalAssetPurge(
		fixture.ctx, claims[0],
	); err != nil {
		t.Fatal(err)
	}
	if err := fixture.database.Conn.QueryRowContext(
		fixture.ctx,
		`SELECT lifecycle_state FROM library_blobs WHERE id=$1`,
		first.File.BlobID,
	).Scan(&blobState); err != nil {
		t.Fatal(err)
	}
	if blobState != "deleted" {
		t.Fatalf("last-reference blob state = %q, want deleted", blobState)
	}
}
