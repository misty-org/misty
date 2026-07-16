package db

import (
	"context"
	"strings"
	"testing"
)

func TestLibraryPreviewDerivativeAuthorizationAndReuse(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, _ := database.CreateUser("Preview Owner", "preview-owner@example.com", "password123")
	outsider, _ := database.CreateUser("Preview Outsider", "preview-outsider@example.com", "password123")
	spaces, _ := database.ListSpaces(ctx, owner.ID)
	spaceID := spaces[0].ID
	item := createPeopleTestImage(t, database, owner.ID, spaceID, "preview.jpg", "1")
	source, err := database.LibraryItemPreviewSource(ctx, owner.ID, spaceID, item.ID, false)
	if err != nil || source.SourceIdentity == "" || source.PreviewObjectKey != "" {
		t.Fatalf("preview source = %#v, %v", source, err)
	}
	if _, err := database.LibraryItemPreviewSource(ctx, outsider.ID, spaceID, item.ID, false); err == nil {
		t.Fatal("outsider received a preview source")
	}
	sha := strings.Repeat("a", 64)
	completed, err := database.CompleteLibraryPreview(ctx, owner.ID, spaceID, item.ID, source.SourceIdentity, "library/preview-object-123456", "image/jpeg", 64_000, sha, false)
	if err != nil || completed.ObjectKey != "library/preview-object-123456" {
		t.Fatalf("complete preview = %#v, %v", completed, err)
	}
	source, err = database.LibraryItemPreviewSource(ctx, owner.ID, spaceID, item.ID, false)
	if err != nil || source.PreviewObjectKey != completed.ObjectKey || source.PreviewBytes != 64_000 || source.PreviewSHA256 != sha {
		t.Fatalf("reused preview source = %#v, %v", source, err)
	}
}
