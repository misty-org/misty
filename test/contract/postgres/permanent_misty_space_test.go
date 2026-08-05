package db

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	. "github.com/kannachi323/misty/server/internal/platform/postgres"
)

func TestCanonicalMistySpaceProvidesIsolatedSupportAndOperatorInbox(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()

	operator, err := database.CreateUserWithUsername("Matt", MistyOperatorUsername, "misty-operator@example.com", "password123")
	if err != nil {
		t.Fatalf("Create operator error = %v", err)
	}
	if err := database.BootstrapMistySpace(ctx, operator.ID); err != nil {
		t.Fatalf("BootstrapMistySpace() error = %v", err)
	}
	first, err := database.CreateUserWithUsername("First User", "misty_first", "misty-first@example.com", "password123")
	if err != nil {
		t.Fatalf("Create first user error = %v", err)
	}
	second, err := database.CreateUserWithUsername("Second User", "misty_second", "misty-second@example.com", "password123")
	if err != nil {
		t.Fatalf("Create second user error = %v", err)
	}

	firstMisty := requireSingleMistySpace(t, database, ctx, first.ID)
	secondMisty := requireSingleMistySpace(t, database, ctx, second.ID)
	operatorMisty := requireSingleMistySpace(t, database, ctx, operator.ID)
	if firstMisty.ID != secondMisty.ID || firstMisty.ID != operatorMisty.ID {
		t.Fatalf("Misty IDs differ: first=%s second=%s operator=%s", firstMisty.ID, secondMisty.ID, operatorMisty.ID)
	}
	if firstMisty.MistyRole != "user" || secondMisty.MistyRole != "user" || operatorMisty.MistyRole != "operator" {
		t.Fatalf("Misty roles = %q, %q, %q", firstMisty.MistyRole, secondMisty.MistyRole, operatorMisty.MistyRole)
	}
	if firstMisty.SupportConversationID == "" || secondMisty.SupportConversationID == "" || firstMisty.SupportConversationID == secondMisty.SupportConversationID {
		t.Fatalf("support conversations were not caller-specific: %q %q", firstMisty.SupportConversationID, secondMisty.SupportConversationID)
	}
	if operatorMisty.SupportConversationID != "" {
		t.Fatalf("operator support_conversation_id = %q, want empty", operatorMisty.SupportConversationID)
	}
	if !firstMisty.Permissions[PermissionMessagesRead] || !firstMisty.Permissions[PermissionMistySupportWrite] ||
		!firstMisty.Permissions[PermissionAttachmentUpload] || !firstMisty.Permissions[PermissionTasksView] ||
		firstMisty.Permissions[PermissionTasksManage] || firstMisty.Permissions[PermissionMessagesWrite] ||
		firstMisty.Permissions[PermissionLibraryView] {
		t.Fatalf("end-user Misty permissions = %#v", firstMisty.Permissions)
	}
	if !operatorMisty.Permissions[PermissionTasksManage] {
		t.Fatalf("operator cannot edit Planner: %#v", operatorMisty.Permissions)
	}

	firstConversations, err := database.SpaceConversations(ctx, first.ID, firstMisty.ID)
	if err != nil || len(firstConversations) != 1 || firstConversations[0].SupportUserID != first.ID {
		t.Fatalf("first conversations = %#v, %v", firstConversations, err)
	}
	if _, _, err := database.CreateSpaceConversationMessageWithReferences(
		ctx, first.ID, firstMisty.ID, firstMisty.SupportConversationID,
		[]MessageSpan{{Type: "text", Text: "I need help"}}, nil, nil, nil, "",
	); err != nil {
		t.Fatalf("support message error = %v", err)
	}
	sha := strings.Repeat("a", 64)
	upload, err := database.CreateLibraryUploadForConversation(
		ctx, first.ID, firstMisty.ID, firstMisty.SupportConversationID,
		UploadPurposeChatAttachment, "screenshot.png", "image/png", 128, sha,
		"library/mistysupporttestobject", "token-hash", time.Now().Add(time.Hour),
	)
	if err != nil {
		t.Fatalf("support attachment reservation error = %v", err)
	}
	if _, err := database.CreateLibraryUploadForConversation(
		ctx, second.ID, secondMisty.ID, firstMisty.SupportConversationID,
		UploadPurposeChatAttachment, "private.png", "image/png", 128, sha,
		"library/mistysupportcrossuser", "other-token", time.Now().Add(time.Hour),
	); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("cross-user attachment reservation error = %v, want forbidden", err)
	}
	if _, err := database.SetLibraryUploadState(ctx, first.ID, firstMisty.ID, upload.ID, "token-hash", "initiated", "uploaded_unverified"); err != nil {
		t.Fatalf("stage support attachment error = %v", err)
	}
	completed, err := database.CompleteLibraryUpload(ctx, first.ID, firstMisty.ID, upload.ID, "token-hash", 128, sha, "image/png", nil)
	if err != nil || completed.Attachment == nil {
		t.Fatalf("complete support attachment = %#v, %v", completed, err)
	}
	if _, _, err := database.CreateSpaceConversationMessageWithReferences(
		ctx, first.ID, firstMisty.ID, firstMisty.SupportConversationID,
		[]MessageSpan{{Type: "text", Text: "Here is a screenshot"}}, nil,
		[]string{completed.Attachment.ID}, nil, "",
	); err != nil {
		t.Fatalf("support attachment message error = %v", err)
	}
	if _, err := database.SpaceConversationMessages(ctx, second.ID, secondMisty.ID, firstMisty.SupportConversationID, 0, 50); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("cross-user message read error = %v, want ErrSpaceForbidden", err)
	}
	page, err := database.MistySupportInbox(ctx, operator.ID, operatorMisty.ID, "active", "first", "", 30)
	if err != nil || len(page.Items) != 1 || page.Items[0].UserID != first.ID || page.Items[0].UnreadCount != 2 {
		t.Fatalf("operator inbox = %#v, %v", page, err)
	}
	if err := database.MarkSpaceConversationRead(ctx, operator.ID, operatorMisty.ID, firstMisty.SupportConversationID, page.Items[0].LatestMessageSeq); err != nil {
		t.Fatalf("mark support read error = %v", err)
	}
	if err := database.DeleteOrClearSpaceConversation(ctx, first.ID, firstMisty.ID, firstMisty.SupportConversationID); err != nil {
		t.Fatalf("clear support error = %v", err)
	}
	remaining, err := database.SpaceConversationMessages(ctx, first.ID, firstMisty.ID, firstMisty.SupportConversationID, 0, 50)
	if err != nil || len(remaining) != 0 {
		t.Fatalf("support clear left messages = %#v, %v", remaining, err)
	}
	if err := database.TestingSpaceTx(ctx, func(tx *sql.Tx) error {
		var used, reserved int64
		if err := tx.QueryRowContext(ctx, `SELECT used_bytes,reserved_bytes FROM misty_support_storage_usage WHERE singleton=1`).Scan(&used, &reserved); err != nil {
			return err
		}
		if used != 0 || reserved != 0 {
			t.Fatalf("support storage after clear = used %d reserved %d", used, reserved)
		}
		var uploadState, blobState string
		if err := tx.QueryRowContext(ctx, `SELECT u.state,b.lifecycle_state FROM space_library_uploads u JOIN library_files f ON f.id=u.file_id JOIN library_blobs b ON b.id=f.blob_id WHERE u.id=$1`, upload.ID).Scan(&uploadState, &blobState); err != nil {
			return err
		}
		if uploadState != "deleted" || blobState != "deleted" {
			t.Fatalf("support cleanup states = upload %q blob %q", uploadState, blobState)
		}
		return nil
	}); err != nil {
		t.Fatalf("inspect support cleanup error = %v", err)
	}

	for index := 0; index < BasicSpaceLimit; index++ {
		if _, err := database.CreateSpace(ctx, first.ID, "Standard Space "+string(rune('A'+index))); err != nil {
			t.Fatalf("CreateSpace(%d) error = %v; Misty must not consume plan capacity", index, err)
		}
	}
	if err := database.AssignMistyOperator(ctx, operator.ID, second.ID); err != nil {
		t.Fatalf("AssignMistyOperator() error = %v", err)
	}
	if _, err := database.BeginAccountDeletion(
		ctx, operator.ID, "deletion_misty_operator", "status-token-hash", 30*24*time.Hour,
	); err != nil {
		t.Fatalf("operator deletion after replacement error = %v", err)
	}
	replacementMisty := requireSingleMistySpace(t, database, ctx, second.ID)
	if replacementMisty.MistyRole != "operator" || replacementMisty.OwnerUserID != second.ID {
		t.Fatalf("replacement operator Space = %#v", replacementMisty)
	}
}

func requireSingleMistySpace(t *testing.T, database *Database, ctx context.Context, userID string) Space {
	t.Helper()
	if err := database.EnsureMistySpace(ctx, userID); err != nil {
		t.Fatalf("EnsureMistySpace() error = %v", err)
	}
	spaces, err := database.ListSpaces(ctx, userID)
	if err != nil {
		t.Fatalf("ListSpaces() error = %v", err)
	}
	var mistySpaces []Space
	for _, space := range spaces {
		if space.Kind == "misty" {
			mistySpaces = append(mistySpaces, space)
		}
	}
	if len(mistySpaces) != 1 {
		t.Fatalf("Misty Spaces = %#v, want exactly one", mistySpaces)
	}
	return mistySpaces[0]
}
