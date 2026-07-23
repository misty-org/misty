package db

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestDefaultPersonalSpaceName(t *testing.T) {
	tests := []struct {
		name     string
		userName string
		want     string
	}{
		{name: "display name", userName: "Owner", want: "Owner's Space"},
		{name: "surrounding whitespace", userName: "  Misty User  ", want: "Misty User's Space"},
		{name: "missing display name", userName: "   ", want: "My Space"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := defaultPersonalSpaceName(test.userName); got != test.want {
				t.Fatalf("defaultPersonalSpaceName(%q) = %q, want %q", test.userName, got, test.want)
			}
		})
	}

	longName := strings.Repeat("猫", 100)
	if got := defaultPersonalSpaceName(longName); utf8.RuneCountInString(got) != 80 || !strings.HasSuffix(got, "'s Space") {
		t.Fatalf("long default name = %q (%d runes), want an 80-rune name ending in apostrophe-s Space", got, utf8.RuneCountInString(got))
	}
}

func TestPersonalSpaceStartsPrivateAndBecomesSharedOnlyByInvite(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()

	owner, err := database.CreateUser("Owner", "space-owner@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser(owner) error = %v", err)
	}
	member, err := database.CreateUser("Member", "space-member@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser(member) error = %v", err)
	}

	ownerSpaces, err := database.ListSpaces(ctx, owner.ID)
	if err != nil {
		t.Fatalf("ListSpaces(owner) error = %v", err)
	}
	if len(ownerSpaces) != 1 || !ownerSpaces[0].IsPersonal || ownerSpaces[0].Name != "Owner's Space" || ownerSpaces[0].IsShared || ownerSpaces[0].MemberCount != 1 {
		t.Fatalf("initial owner Spaces = %#v, want one private owner-named Space", ownerSpaces)
	}
	personal := ownerSpaces[0]
	renamed, err := database.RenameSpace(ctx, owner.ID, personal.ID, "Home base")
	if err != nil || renamed.Name != "Home base" || !renamed.IsPersonal {
		t.Fatalf("RenameSpace(default) = %#v, %v, want renamed personal Space", renamed, err)
	}

	if _, _, err := database.CreateSpaceMessage(ctx, owner.ID, personal.ID, []MessageSpan{{Type: "text", Text: "Private hello"}}, nil); err != nil {
		t.Fatalf("CreateSpaceMessage(Personal) error = %v", err)
	}

	additional, err := database.CreateSpace(ctx, owner.ID, "Project")
	if err != nil {
		t.Fatalf("CreateSpace(Project) error = %v", err)
	}
	if additional.IsPersonal || additional.IsShared {
		t.Fatalf("new Space = %#v, want private non-Personal Space", additional)
	}
	secondAdditional, err := database.CreateSpace(ctx, owner.ID, "Another")
	if err != nil || secondAdditional.IsPersonal {
		t.Fatalf("CreateSpace(second additional) = %#v, %v, want success", secondAdditional, err)
	}
	if _, err := database.CreateSpace(ctx, owner.ID, "Fourth total"); err != nil {
		t.Fatalf("CreateSpace(fourth total) error = %v, want unlimited owned Spaces", err)
	}
	if err := database.DeleteSpace(ctx, owner.ID, secondAdditional.ID, secondAdditional.Name); err != nil {
		t.Fatalf("DeleteSpace(second additional) error = %v", err)
	}
	if _, err := database.CreateSpace(ctx, owner.ID, "Still another Space"); err != nil {
		t.Fatalf("CreateSpace while deletion pending error = %v, want unlimited owned Spaces", err)
	}

	memberSpaces, err := database.ListSpaces(ctx, member.ID)
	if err != nil || len(memberSpaces) != 1 || !memberSpaces[0].IsPersonal || memberSpaces[0].Name != "Member's Space" {
		t.Fatalf("ListSpaces(member) = %#v, %v, want member-named personal Space", memberSpaces, err)
	}

	invite, err := database.InviteToSpace(ctx, owner.ID, personal.ID, member.Email)
	if err != nil {
		t.Fatalf("InviteToSpace(Personal) error = %v", err)
	}
	personalAfterInvite, err := database.SpaceByID(ctx, owner.ID, personal.ID)
	if err != nil || !personalAfterInvite.IsShared || personalAfterInvite.PendingCount != 1 {
		t.Fatalf("Personal after invite = %#v, %v, want shared with one pending", personalAfterInvite, err)
	}
	secondInvite, err := database.InviteToSpace(ctx, owner.ID, additional.ID, member.Email)
	if err != nil {
		t.Fatalf("InviteToSpace(second owned Space) error = %v, want unlimited joined Spaces", err)
	}
	if _, err := database.RespondToSpaceInvite(ctx, member.ID, secondInvite.ID, true); err != nil {
		t.Fatalf("RespondToSpaceInvite(second Space) error = %v", err)
	}

	if _, err := database.RespondToSpaceInvite(ctx, member.ID, invite.ID, true); err != nil {
		t.Fatalf("RespondToSpaceInvite() error = %v", err)
	}
	personalAfterAccept, err := database.SpaceByID(ctx, owner.ID, personal.ID)
	if err != nil || !personalAfterAccept.IsShared || personalAfterAccept.MemberCount != 2 || personalAfterAccept.PendingCount != 0 {
		t.Fatalf("Personal after accept = %#v, %v, want two active members", personalAfterAccept, err)
	}
	message, _, err := database.CreateSpaceMessage(ctx, owner.ID, personal.ID, []MessageSpan{{Type: "text", Text: "Shared hello"}}, nil)
	if err != nil {
		t.Fatalf("CreateSpaceMessage(shared Personal) error = %v", err)
	}
	if message.SenderUserID != owner.ID {
		t.Fatalf("shared message sender = %q, want %q", message.SenderUserID, owner.ID)
	}
	edited, err := database.UpdateSpaceMessage(ctx, owner.ID, personal.ID, message.ID, []MessageSpan{{Type: "text", Text: "Edited hello"}}, nil)
	if err != nil || edited.EditedAt == nil || len(edited.Content) != 1 || edited.Content[0].Text != "Edited hello" {
		t.Fatalf("UpdateSpaceMessage(owner) = %#v, %v, want edited message", edited, err)
	}
	if _, err := database.UpdateSpaceMessage(ctx, member.ID, personal.ID, message.ID, []MessageSpan{{Type: "text", Text: "Not mine"}}, nil); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("UpdateSpaceMessage(member) error = %v, want ErrSpaceForbidden", err)
	}
	inbox, err := database.SpaceInbox(ctx, member.ID, "unreads", 20)
	if err != nil {
		t.Fatalf("SpaceInbox(member) error = %v", err)
	}
	if len(inbox) != 1 || inbox[0].MessageID != message.ID {
		t.Fatalf("member inbox = %#v, want unread delivery for %q", inbox, message.ID)
	}

	if err := database.RemoveSpaceMember(ctx, owner.ID, personal.ID, member.ID); err != nil {
		t.Fatalf("RemoveSpaceMember() error = %v", err)
	}
	personalAfterRemove, err := database.SpaceByID(ctx, owner.ID, personal.ID)
	if err != nil || personalAfterRemove.IsShared || personalAfterRemove.MemberCount != 1 {
		t.Fatalf("Personal after remove = %#v, %v, want private again", personalAfterRemove, err)
	}
	if err := database.DeleteSpace(ctx, owner.ID, personal.ID, personal.Name); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("DeleteSpace(Personal) error = %v, want ErrSpaceForbidden", err)
	}
}

func TestOwnershipTransferRequiresRecipientStorageCapacity(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Transfer Owner", "transfer-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	recipient, err := database.CreateUser("Transfer Recipient", "transfer-recipient@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	project, err := database.CreateSpace(ctx, owner.ID, "Transfer project")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := database.InviteToSpace(ctx, owner.ID, project.ID, recipient.Email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.RespondToSpaceInvite(ctx, recipient.ID, invite.ID, true); err != nil {
		t.Fatal(err)
	}
	recipientSpaces, err := database.ListSpaces(ctx, recipient.ID)
	if err != nil {
		t.Fatal(err)
	}
	var recipientPersonal string
	for _, space := range recipientSpaces {
		if space.IsPersonal {
			recipientPersonal = space.ID
		}
	}
	if recipientPersonal == "" {
		t.Fatal("recipient personal Space missing")
	}
	setUsage := func(spaceID string, used int64) {
		t.Helper()
		if err := database.spaceTx(ctx, func(tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `UPDATE space_storage_usage SET used_bytes=$2,version=version+1,updated_at=NOW() WHERE space_id=$1`, spaceID, used)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	setUsage(project.ID, 200_000_000)
	setUsage(recipientPersonal, 1_900_000_000)
	if err := database.TransferSpaceOwnership(ctx, owner.ID, project.ID, recipient.ID); !errors.Is(err, ErrLibraryQuota) {
		t.Fatalf("over-capacity transfer = %v, want ErrLibraryQuota", err)
	}
	setUsage(recipientPersonal, 1_700_000_000)
	if err := database.TransferSpaceOwnership(ctx, owner.ID, project.ID, recipient.ID); err != nil {
		t.Fatalf("transfer with capacity = %v", err)
	}
	transferred, err := database.SpaceByID(ctx, recipient.ID, project.ID)
	if err != nil || transferred.OwnerUserID != recipient.ID {
		t.Fatalf("transferred Space = %#v, %v", transferred, err)
	}
}

func TestSpaceChatPermissionsAreEnforcedAcrossMessagesInboxAndRealtime(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()

	owner, err := database.CreateUser("Chat Owner", "chat-permission-owner@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser(owner) error = %v", err)
	}
	member, err := database.CreateUser("Chat Member", "chat-permission-member@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser(member) error = %v", err)
	}
	spaces, err := database.ListSpaces(ctx, owner.ID)
	if err != nil || len(spaces) != 1 {
		t.Fatalf("ListSpaces(owner) = %#v, %v", spaces, err)
	}
	space := spaces[0]
	invite, err := database.InviteToSpace(ctx, owner.ID, space.ID, member.Email)
	if err != nil {
		t.Fatalf("InviteToSpace() error = %v", err)
	}
	if _, err := database.RespondToSpaceInvite(ctx, member.ID, invite.ID, true); err != nil {
		t.Fatalf("RespondToSpaceInvite() error = %v", err)
	}

	memberSpace, err := database.SpaceByID(ctx, member.ID, space.ID)
	if err != nil || !memberSpace.Permissions[PermissionMessagesRead] || !memberSpace.Permissions[PermissionMessagesWrite] {
		t.Fatalf("default member chat permissions = %#v, %v, want read and write", memberSpace, err)
	}
	if _, _, err := database.CreateSpaceMessage(ctx, member.ID, space.ID, []MessageSpan{{Type: "text", Text: "Member can post by default"}}, nil); err != nil {
		t.Fatalf("CreateSpaceMessage(member default) error = %v", err)
	}
	chatNode, err := database.UpsertSpaceNode(ctx, owner.ID, SpaceNode{SpaceID: space.ID, Kind: "link", DisplayName: "Shared chat link", TargetCipher: []byte("cipher"), TargetNonce: []byte("nonce")})
	if err != nil {
		t.Fatalf("UpsertSpaceNode(owner) error = %v", err)
	}
	if nodes, err := database.SpaceNodes(ctx, member.ID, space.ID); err != nil || len(nodes) != 1 || nodes[0].ID != chatNode.ID {
		t.Fatalf("SpaceNodes(member default) = %#v, %v", nodes, err)
	}

	if err := database.SetSpaceMemberPermission(ctx, owner.ID, space.ID, member.ID, PermissionMessagesWrite, "deny"); err != nil {
		t.Fatalf("deny messages.write error = %v", err)
	}
	if _, _, err := database.CreateSpaceMessage(ctx, member.ID, space.ID, []MessageSpan{{Type: "text", Text: "Must not post"}}, nil); !errors.Is(err, ErrLibraryForbidden) {
		t.Fatalf("CreateSpaceMessage(write denied) error = %v, want ErrLibraryForbidden", err)
	}
	if _, err := database.UpsertSpaceNode(ctx, member.ID, SpaceNode{SpaceID: space.ID, Kind: "folder", DisplayName: "Must not create"}); !errors.Is(err, ErrLibraryForbidden) {
		t.Fatalf("UpsertSpaceNode(write denied) error = %v, want ErrLibraryForbidden", err)
	}
	if err := database.DeleteSpaceNode(ctx, member.ID, space.ID, chatNode.ID); !errors.Is(err, ErrLibraryForbidden) {
		t.Fatalf("DeleteSpaceNode(write denied) error = %v, want ErrLibraryForbidden", err)
	}
	if err := database.MarkSpaceNodeStale(ctx, member.ID, space.ID, chatNode.ID); !errors.Is(err, ErrLibraryForbidden) {
		t.Fatalf("MarkSpaceNodeStale(write denied) error = %v, want ErrLibraryForbidden", err)
	}
	ownerMessage, _, err := database.CreateSpaceMessage(ctx, owner.ID, space.ID, []MessageSpan{{Type: "text", Text: "Visible until read is revoked"}}, nil)
	if err != nil {
		t.Fatalf("CreateSpaceMessage(owner) error = %v", err)
	}
	if inbox, err := database.SpaceInbox(ctx, member.ID, "unreads", 20); err != nil || !containsInboxMessage(inbox, ownerMessage.ID) {
		t.Fatalf("SpaceInbox(before read deny) = %#v, %v, want message %q", inbox, err, ownerMessage.ID)
	}

	ownerEvents, _, err := database.SpaceEventsAfter(ctx, owner.ID, 0, 500)
	if err != nil {
		t.Fatalf("SpaceEventsAfter(owner) error = %v", err)
	}
	var ownerMessageEventID, ownerNodeEventID int64
	for _, event := range ownerEvents {
		if event.EventType == "message.created" && event.EntityID == ownerMessage.ID {
			ownerMessageEventID = event.ID
		}
		if event.EventType == "node.created" && event.EntityID == chatNode.ID {
			ownerNodeEventID = event.ID
		}
	}
	if ownerMessageEventID == 0 || ownerNodeEventID == 0 {
		t.Fatalf("owner events = %#v, want message.created for %q and node.created for %q", ownerEvents, ownerMessage.ID, chatNode.ID)
	}
	if err := database.SetSpaceMemberPermission(ctx, owner.ID, space.ID, member.ID, PermissionLibraryView, "deny"); err != nil {
		t.Fatalf("deny library.view error = %v", err)
	}
	var libraryEventID int64
	if err := database.spaceTx(ctx, func(tx *sql.Tx) error {
		var eventErr error
		libraryEventID, eventErr = recordSpaceEventTx(ctx, tx, space.ID, owner.ID, "library.upload.ready", "upload_private", map[string]string{"item_id": "item_private"})
		return eventErr
	}); err != nil {
		t.Fatal(err)
	}
	if event, err := database.EventByIDForUser(ctx, member.ID, libraryEventID); !errors.Is(err, ErrSpaceNotFound) || event != nil {
		t.Fatalf("EventByIDForUser after library.view deny = %#v, %v", event, err)
	}

	if err := database.SetSpaceMemberPermission(ctx, owner.ID, space.ID, member.ID, PermissionMessagesRead, "deny"); err != nil {
		t.Fatalf("deny messages.read error = %v", err)
	}
	if err := database.SetSpaceMemberPermission(ctx, owner.ID, space.ID, member.ID, PermissionMessagesWrite, "allow"); err != nil {
		t.Fatalf("allow messages.write under read denial error = %v", err)
	}
	memberSpace, err = database.SpaceByID(ctx, member.ID, space.ID)
	if err != nil || memberSpace.Permissions[PermissionMessagesRead] || memberSpace.Permissions[PermissionMessagesWrite] {
		t.Fatalf("dependent member chat permissions = %#v, %v, want read and effective write denied", memberSpace, err)
	}
	if messages, err := database.SpaceMessages(ctx, member.ID, space.ID, 0, 20); !errors.Is(err, ErrLibraryForbidden) || len(messages) != 0 {
		t.Fatalf("SpaceMessages(read denied) = %#v, %v, want ErrLibraryForbidden", messages, err)
	}
	if nodes, err := database.SpaceNodes(ctx, member.ID, space.ID); !errors.Is(err, ErrLibraryForbidden) || len(nodes) != 0 {
		t.Fatalf("SpaceNodes(read denied) = %#v, %v, want ErrLibraryForbidden", nodes, err)
	}
	if node, err := database.SpaceNodeSecret(ctx, member.ID, space.ID, chatNode.ID); !errors.Is(err, ErrLibraryForbidden) || node != nil {
		t.Fatalf("SpaceNodeSecret(read denied) = %#v, %v, want ErrLibraryForbidden", node, err)
	}
	if err := database.CreateResolveTicket(ctx, member.ID, space.ID, chatNode.ID, "open", "read-denied-ticket", time.Now().Add(time.Minute)); !errors.Is(err, ErrLibraryForbidden) {
		t.Fatalf("CreateResolveTicket(read denied) error = %v, want ErrLibraryForbidden", err)
	}
	if err := database.MarkSpaceRead(ctx, member.ID, space.ID, ownerMessage.Seq); !errors.Is(err, ErrLibraryForbidden) {
		t.Fatalf("MarkSpaceRead(read denied) error = %v, want ErrLibraryForbidden", err)
	}
	if _, _, err := database.CreateSpaceMessage(ctx, member.ID, space.ID, []MessageSpan{{Type: "text", Text: "Read denial also blocks writes"}}, nil); !errors.Is(err, ErrLibraryForbidden) {
		t.Fatalf("CreateSpaceMessage(read denied) error = %v, want ErrLibraryForbidden", err)
	}
	if inbox, err := database.SpaceInbox(ctx, member.ID, "unreads", 20); err != nil || containsSpaceMessageInbox(inbox, space.ID) {
		t.Fatalf("SpaceInbox(read denied) = %#v, %v, want no message previews from denied Space", inbox, err)
	}
	memberEvents, _, err := database.SpaceEventsAfter(ctx, member.ID, 0, 500)
	if err != nil {
		t.Fatalf("SpaceEventsAfter(member denied) error = %v", err)
	}
	for _, event := range memberEvents {
		if event.SpaceID == space.ID && (strings.HasPrefix(event.EventType, "message.") || strings.HasPrefix(event.EventType, "node.") || strings.HasPrefix(event.EventType, "library.")) {
			t.Fatalf("permission-denied member received protected realtime event %#v", event)
		}
	}
	if event, err := database.EventByIDForUser(ctx, member.ID, ownerMessageEventID); !errors.Is(err, ErrSpaceNotFound) || event != nil {
		t.Fatalf("EventByIDForUser(read denied) = %#v, %v, want ErrSpaceNotFound", event, err)
	}
	if event, err := database.EventByIDForUser(ctx, member.ID, ownerNodeEventID); !errors.Is(err, ErrSpaceNotFound) || event != nil {
		t.Fatalf("EventByIDForUser(node read denied) = %#v, %v, want ErrSpaceNotFound", event, err)
	}
}

func TestSpaceGroupConversationsStayScopedToSelectedMembers(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Group Owner", "group-owner@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser(owner) error = %v", err)
	}
	member, err := database.CreateUser("Included Member", "group-member@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser(member) error = %v", err)
	}
	excluded, err := database.CreateUser("Excluded Member", "group-excluded@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser(excluded) error = %v", err)
	}
	spaces, err := database.ListSpaces(ctx, owner.ID)
	if err != nil || len(spaces) != 1 {
		t.Fatalf("ListSpaces(owner) = %#v, %v", spaces, err)
	}
	space := spaces[0]
	for _, invited := range []*User{member, excluded} {
		invite, inviteErr := database.InviteToSpace(ctx, owner.ID, space.ID, invited.Email)
		if inviteErr != nil {
			t.Fatalf("InviteToSpace(%s) error = %v", invited.Email, inviteErr)
		}
		if _, inviteErr = database.RespondToSpaceInvite(ctx, invited.ID, invite.ID, true); inviteErr != nil {
			t.Fatalf("RespondToSpaceInvite(%s) error = %v", invited.Email, inviteErr)
		}
	}

	conversation, err := database.CreateSpaceConversation(ctx, owner.ID, space.ID, "Launch crew", []string{member.ID})
	if err != nil {
		t.Fatalf("CreateSpaceConversation() error = %v", err)
	}
	if len(conversation.Members) != 2 {
		t.Fatalf("conversation members = %#v, want creator and selected member", conversation.Members)
	}
	memberConversations, err := database.SpaceConversations(ctx, member.ID, space.ID)
	if err != nil || len(memberConversations) != 1 || memberConversations[0].ID != conversation.ID {
		t.Fatalf("SpaceConversations(included) = %#v, %v", memberConversations, err)
	}
	excludedConversations, err := database.SpaceConversations(ctx, excluded.ID, space.ID)
	if err != nil || len(excludedConversations) != 0 {
		t.Fatalf("SpaceConversations(excluded) = %#v, %v, want none", excludedConversations, err)
	}

	message, _, err := database.CreateSpaceConversationMessageWithReferences(ctx, member.ID, space.ID, conversation.ID, []MessageSpan{{Type: "text", Text: "Private launch note"}}, nil, nil, nil, "")
	if err != nil {
		t.Fatalf("CreateSpaceConversationMessageWithReferences() error = %v", err)
	}
	if message.ConversationID != conversation.ID {
		t.Fatalf("message conversation = %q, want %q", message.ConversationID, conversation.ID)
	}
	ownerEvents, _, err := database.SpaceEventsAfter(ctx, owner.ID, 0, 500)
	if err != nil {
		t.Fatalf("SpaceEventsAfter(owner) error = %v", err)
	}
	var groupMessageEventID int64
	for _, event := range ownerEvents {
		if event.EventType == "message.created" && event.EntityID == message.ID {
			groupMessageEventID = event.ID
		}
	}
	if groupMessageEventID == 0 {
		t.Fatalf("owner events = %#v, want group message event", ownerEvents)
	}
	excludedEvents, _, err := database.SpaceEventsAfter(ctx, excluded.ID, 0, 500)
	if err != nil {
		t.Fatalf("SpaceEventsAfter(excluded) error = %v", err)
	}
	for _, event := range excludedEvents {
		if event.ID == groupMessageEventID {
			t.Fatalf("excluded member received private group event %#v", event)
		}
	}
	if event, eventErr := database.EventByIDForUser(ctx, excluded.ID, groupMessageEventID); !errors.Is(eventErr, ErrSpaceNotFound) || event != nil {
		t.Fatalf("EventByIDForUser(excluded) = %#v, %v, want ErrSpaceNotFound", event, eventErr)
	}
	groupMessages, err := database.SpaceConversationMessages(ctx, owner.ID, space.ID, conversation.ID, 0, 20)
	if err != nil || len(groupMessages) != 1 || groupMessages[0].ID != message.ID {
		t.Fatalf("SpaceConversationMessages(owner) = %#v, %v", groupMessages, err)
	}
	if _, err := database.SpaceConversationMessages(ctx, excluded.ID, space.ID, conversation.ID, 0, 20); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("SpaceConversationMessages(excluded) error = %v, want ErrSpaceForbidden", err)
	}
	selectedGroup, err := database.IsSpaceConversationForMember(ctx, member.ID, space.ID, conversation.ID)
	if err != nil || !selectedGroup {
		t.Fatalf("IsSpaceConversationForMember(included) = %v, %v, want true", selectedGroup, err)
	}
	selectedGroup, err = database.IsSpaceConversationForMember(ctx, member.ID, space.ID, message.ID)
	if err != nil || selectedGroup {
		t.Fatalf("IsSpaceConversationForMember(everyone message) = %v, %v, want false", selectedGroup, err)
	}
	if selectedGroup, err = database.IsSpaceConversationForMember(ctx, excluded.ID, space.ID, conversation.ID); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("IsSpaceConversationForMember(excluded) = %v, %v, want ErrSpaceForbidden", selectedGroup, err)
	}
	if _, _, err := database.CreateSpaceConversationMessageWithReferences(ctx, excluded.ID, space.ID, conversation.ID, []MessageSpan{{Type: "text", Text: "Not allowed"}}, nil, nil, nil, ""); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("CreateSpaceConversationMessageWithReferences(excluded) error = %v, want ErrSpaceForbidden", err)
	}
	if _, _, err := database.CreateSpaceConversationMessageWithReferences(ctx, owner.ID, space.ID, conversation.ID, []MessageSpan{{Type: "mention", UserID: excluded.ID, Label: excluded.Name}}, nil, nil, nil, ""); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("mention excluded member error = %v, want ErrSpaceInvalid", err)
	}
	defaultMessages, err := database.SpaceMessages(ctx, owner.ID, space.ID, 0, 20)
	if err != nil || len(defaultMessages) != 0 {
		t.Fatalf("SpaceMessages(default) = %#v, %v, want group message isolation", defaultMessages, err)
	}
}

func TestUpdateSpaceConversationRestrictedToCreator(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Update Owner", "update-owner@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser(owner) error = %v", err)
	}
	member, err := database.CreateUser("Update Member", "update-member@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser(member) error = %v", err)
	}
	outsider, err := database.CreateUser("Update Outsider", "update-outsider@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser(outsider) error = %v", err)
	}
	spaces, err := database.ListSpaces(ctx, owner.ID)
	if err != nil || len(spaces) != 1 {
		t.Fatalf("ListSpaces(owner) = %#v, %v", spaces, err)
	}
	space := spaces[0]
	for _, invited := range []*User{member, outsider} {
		invite, inviteErr := database.InviteToSpace(ctx, owner.ID, space.ID, invited.Email)
		if inviteErr != nil {
			t.Fatalf("InviteToSpace(%s) error = %v", invited.Email, inviteErr)
		}
		if _, inviteErr = database.RespondToSpaceInvite(ctx, invited.ID, invite.ID, true); inviteErr != nil {
			t.Fatalf("RespondToSpaceInvite(%s) error = %v", invited.Email, inviteErr)
		}
	}

	conversation, err := database.CreateSpaceConversation(ctx, owner.ID, space.ID, "Launch crew", []string{member.ID})
	if err != nil {
		t.Fatalf("CreateSpaceConversation() error = %v", err)
	}

	// A non-creator member can read and write messages, but cannot rename the
	// conversation or change who's in it.
	if _, err := database.UpdateSpaceConversation(ctx, member.ID, space.ID, conversation.ID, "Hijacked name", []string{owner.ID, member.ID}); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("UpdateSpaceConversation(non-creator member) error = %v, want ErrSpaceForbidden", err)
	}

	// An outsider who isn't even in the conversation is rejected too.
	if _, err := database.UpdateSpaceConversation(ctx, outsider.ID, space.ID, conversation.ID, "Hijacked name", []string{owner.ID, outsider.ID}); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("UpdateSpaceConversation(outsider not in conversation) error = %v, want ErrSpaceForbidden", err)
	}

	// The creator can rename the conversation and add a new member.
	updated, err := database.UpdateSpaceConversation(ctx, owner.ID, space.ID, conversation.ID, "Renamed crew", []string{member.ID, outsider.ID})
	if err != nil {
		t.Fatalf("UpdateSpaceConversation(creator, add member) error = %v", err)
	}
	if updated.Title != "Renamed crew" || len(updated.Members) != 3 {
		t.Fatalf("updated conversation = %#v, want renamed with 3 members", updated)
	}
	outsiderConversations, err := database.SpaceConversations(ctx, outsider.ID, space.ID)
	if err != nil || len(outsiderConversations) != 1 || outsiderConversations[0].ID != conversation.ID {
		t.Fatalf("SpaceConversations(newly added member) = %#v, %v", outsiderConversations, err)
	}

	// The creator can also remove a member; that member immediately loses
	// access to the conversation and its messages.
	if _, err := database.UpdateSpaceConversation(ctx, owner.ID, space.ID, conversation.ID, "Renamed crew", []string{outsider.ID}); err != nil {
		t.Fatalf("UpdateSpaceConversation(creator, remove member) error = %v", err)
	}
	memberConversationsAfterRemoval, err := database.SpaceConversations(ctx, member.ID, space.ID)
	if err != nil || len(memberConversationsAfterRemoval) != 0 {
		t.Fatalf("SpaceConversations(removed member) = %#v, %v, want none", memberConversationsAfterRemoval, err)
	}
	if _, err := database.SpaceConversationMessages(ctx, member.ID, space.ID, conversation.ID, 0, 20); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("SpaceConversationMessages(removed member) error = %v, want ErrSpaceForbidden", err)
	}
}

func containsInboxMessage(items []SpaceInboxItem, messageID string) bool {
	for _, item := range items {
		if item.MessageID == messageID {
			return true
		}
	}
	return false
}

func containsSpaceMessageInbox(items []SpaceInboxItem, spaceID string) bool {
	for _, item := range items {
		if item.SpaceID == spaceID && item.MessageID != "" {
			return true
		}
	}
	return false
}
