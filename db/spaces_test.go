package db

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

func TestAccountsStartWithoutSpacesAndSpacesBecomeSharedOnlyByInvite(t *testing.T) {
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
	if len(ownerSpaces) != 0 {
		t.Fatalf("initial owner Spaces = %#v, want create-first empty state", ownerSpaces)
	}
	project, err := database.CreateSpace(ctx, owner.ID, "Project")
	if err != nil {
		t.Fatalf("CreateSpace(Project) error = %v", err)
	}
	renamed, err := database.RenameSpace(ctx, owner.ID, project.ID, "Home base")
	if err != nil || renamed.Name != "Home base" {
		t.Fatalf("RenameSpace() = %#v, %v, want renamed Space", renamed, err)
	}
	secondAdditional, err := database.CreateSpace(ctx, owner.ID, "Another")
	if err != nil {
		t.Fatalf("CreateSpace(second additional) = %#v, %v, want success", secondAdditional, err)
	}
	if _, err := database.CreateSpace(ctx, owner.ID, "Third total"); err != nil {
		t.Fatalf("CreateSpace(third total) error = %v, want Basic limit to allow three", err)
	}
	if err := database.DeleteSpace(ctx, owner.ID, secondAdditional.ID, secondAdditional.Name); err != nil {
		t.Fatalf("DeleteSpace(second additional) error = %v", err)
	}
	if _, err := database.CreateSpace(ctx, owner.ID, "Still another Space"); !errors.Is(err, ErrSpaceLimit) {
		t.Fatalf("CreateSpace while deletion pending error = %v, want ErrSpaceLimit because inactive memberships still count", err)
	}

	memberSpaces, err := database.ListSpaces(ctx, member.ID)
	if err != nil || len(memberSpaces) != 0 {
		t.Fatalf("ListSpaces(member) = %#v, %v, want empty create-first state", memberSpaces, err)
	}

	invite, err := database.InviteToSpace(ctx, owner.ID, project.ID, member.Email)
	if err != nil {
		t.Fatalf("InviteToSpace() error = %v", err)
	}
	projectAfterInvite, err := database.SpaceByID(ctx, owner.ID, project.ID)
	if err != nil || !projectAfterInvite.IsShared || projectAfterInvite.PendingCount != 1 {
		t.Fatalf("Space after invite = %#v, %v, want shared with one pending", projectAfterInvite, err)
	}

	if _, err := database.RespondToSpaceInvite(ctx, member.ID, invite.ID, true); err != nil {
		t.Fatalf("RespondToSpaceInvite() error = %v", err)
	}
	projectAfterAccept, err := database.SpaceByID(ctx, owner.ID, project.ID)
	if err != nil || !projectAfterAccept.IsShared || projectAfterAccept.MemberCount != 2 || projectAfterAccept.PendingCount != 0 {
		t.Fatalf("Space after accept = %#v, %v, want two active members", projectAfterAccept, err)
	}
	message, _, err := database.CreateSpaceMessage(ctx, owner.ID, project.ID, []MessageSpan{{Type: "text", Text: "Shared hello"}}, nil)
	if err != nil {
		t.Fatalf("CreateSpaceMessage(shared Personal) error = %v", err)
	}
	if message.SenderUserID != owner.ID {
		t.Fatalf("shared message sender = %q, want %q", message.SenderUserID, owner.ID)
	}
	edited, err := database.UpdateSpaceMessage(ctx, owner.ID, project.ID, message.ID, []MessageSpan{{Type: "text", Text: "Edited hello"}}, nil)
	if err != nil || edited.EditedAt == nil || len(edited.Content) != 1 || edited.Content[0].Text != "Edited hello" {
		t.Fatalf("UpdateSpaceMessage(owner) = %#v, %v, want edited message", edited, err)
	}
	if _, err := database.UpdateSpaceMessage(ctx, member.ID, project.ID, message.ID, []MessageSpan{{Type: "text", Text: "Not mine"}}, nil); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("UpdateSpaceMessage(member) error = %v, want ErrSpaceForbidden", err)
	}
	inbox, err := database.SpaceInbox(ctx, member.ID, "unreads", 20)
	if err != nil {
		t.Fatalf("SpaceInbox(member) error = %v", err)
	}
	if len(inbox) != 1 || inbox[0].MessageID != message.ID {
		t.Fatalf("member inbox = %#v, want unread delivery for %q", inbox, message.ID)
	}
	reacted, err := database.AddSpaceMessageReaction(ctx, member.ID, project.ID, message.ID, "😂")
	if err != nil {
		t.Fatalf("AddSpaceMessageReaction(member) error = %v", err)
	}
	if len(reacted.Reactions) != 1 || reacted.Reactions[0].Emoji != "😂" || reacted.Reactions[0].Count != 1 || !reacted.Reactions[0].ReactedByMe {
		t.Fatalf("member reacted message = %#v, want one self reaction", reacted.Reactions)
	}
	if _, err := database.AddSpaceMessageReaction(ctx, member.ID, project.ID, message.ID, "😂"); err != nil {
		t.Fatalf("duplicate AddSpaceMessageReaction(member) error = %v", err)
	}
	ownerView, err := database.SpaceMessages(ctx, owner.ID, project.ID, 0, 20)
	if err != nil {
		t.Fatalf("SpaceMessages(owner after reaction) error = %v", err)
	}
	if len(ownerView) == 0 || len(ownerView[0].Reactions) != 1 || ownerView[0].Reactions[0].Count != 1 || ownerView[0].Reactions[0].ReactedByMe {
		t.Fatalf("owner reaction view = %#v, want count without self flag", ownerView)
	}
	unreacted, err := database.RemoveSpaceMessageReaction(ctx, member.ID, project.ID, message.ID, "😂")
	if err != nil {
		t.Fatalf("RemoveSpaceMessageReaction(member) error = %v", err)
	}
	if len(unreacted.Reactions) != 0 {
		t.Fatalf("removed reaction message = %#v, want no reactions", unreacted.Reactions)
	}
	events, _, err := database.SpaceEventsAfter(ctx, owner.ID, 0, 500)
	if err != nil {
		t.Fatalf("SpaceEventsAfter(owner) error = %v", err)
	}
	if !containsSpaceEvent(events, "message.reaction_added", message.ID) || !containsSpaceEvent(events, "message.reaction_removed", message.ID) {
		t.Fatalf("reaction events = %#v, want add and remove events for %q", events, message.ID)
	}

	if err := database.RemoveSpaceMember(ctx, owner.ID, project.ID, member.ID); err != nil {
		t.Fatalf("RemoveSpaceMember() error = %v", err)
	}
	projectAfterRemove, err := database.SpaceByID(ctx, owner.ID, project.ID)
	if err != nil || projectAfterRemove.IsShared || projectAfterRemove.MemberCount != 1 {
		t.Fatalf("Space after remove = %#v, %v, want private again", projectAfterRemove, err)
	}
	if err := database.DeleteSpace(ctx, owner.ID, project.ID, projectAfterRemove.Name); err != nil {
		t.Fatalf("DeleteSpace() error = %v", err)
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
	recipientOwned, err := database.CreateSpace(ctx, recipient.ID, "Recipient workspace")
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
	setUsage(recipientOwned.ID, 1_900_000_000)
	if err := database.TransferSpaceOwnership(ctx, owner.ID, project.ID, recipient.ID); !errors.Is(err, ErrLibraryQuota) {
		t.Fatalf("over-capacity transfer = %v, want ErrLibraryQuota", err)
	}
	setUsage(recipientOwned.ID, 1_700_000_000)
	if err := database.TransferSpaceOwnership(ctx, owner.ID, project.ID, recipient.ID); err != nil {
		t.Fatalf("transfer with capacity = %v", err)
	}
	transferred, err := database.SpaceByID(ctx, recipient.ID, project.ID)
	if err != nil || transferred.OwnerUserID != recipient.ID {
		t.Fatalf("transferred Space = %#v, %v", transferred, err)
	}
}

func TestFixedMemberCollaborationPermissionsAreEnforced(t *testing.T) {
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
	outsider, err := database.CreateUser("Chat Outsider", "chat-permission-outsider@example.com", "password123")
	if err != nil {
		t.Fatalf("CreateUser(outsider) error = %v", err)
	}
	space := createTestSpace(t, database, ctx, owner.ID, "Chat")
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
	for _, permission := range []string{
		PermissionAttachmentUpload,
		PermissionLibraryView,
		PermissionLibraryUpload,
		PermissionLibraryAdd,
		PermissionLibraryEdit,
		PermissionLibraryDownload,
		PermissionLibraryImport,
		PermissionTasksView,
		PermissionTasksManage,
	} {
		if !memberSpace.Permissions[permission] {
			t.Fatalf("member permission %q = false, want fixed collaboration access", permission)
		}
	}
	for _, permission := range []string{
		PermissionIntegrationsManage,
		PermissionStorageManage,
		PermissionStorageViewMembers,
		PermissionStudioManage,
	} {
		if memberSpace.Permissions[permission] {
			t.Fatalf("member permission %q = true, want owner-only administration", permission)
		}
	}

	memberMessage, _, err := database.CreateSpaceMessage(
		ctx,
		member.ID,
		space.ID,
		[]MessageSpan{{Type: "text", Text: "Member can post by default"}},
		nil,
	)
	if err != nil {
		t.Fatalf("CreateSpaceMessage(member) error = %v", err)
	}
	if _, err := database.CreateSpaceTask(ctx, member.ID, SpaceTask{
		SpaceID: space.ID,
		Title:   "Member-created task",
		Status:  "todo",
	}); err != nil {
		t.Fatalf("CreateSpaceTask(member) error = %v", err)
	}
	if _, _, err := database.CreateSpaceMessage(
		ctx,
		outsider.ID,
		space.ID,
		[]MessageSpan{{Type: "text", Text: "Not a member"}},
		nil,
	); !errors.Is(err, ErrLibraryForbidden) {
		t.Fatalf("CreateSpaceMessage(outsider) error = %v, want ErrLibraryForbidden", err)
	}
	if _, err := database.InviteToSpace(ctx, member.ID, space.ID, outsider.Email); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("InviteToSpace(member) error = %v, want ErrSpaceForbidden", err)
	}
	if err := database.RemoveSpaceMember(ctx, member.ID, space.ID, owner.ID); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("RemoveSpaceMember(member) error = %v, want ErrSpaceForbidden", err)
	}
	if err := database.DeleteSpace(ctx, member.ID, space.ID, space.Name); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("DeleteSpace(member) error = %v, want ErrSpaceForbidden", err)
	}

	ownerMessage, _, err := database.CreateSpaceMessage(
		ctx,
		owner.ID,
		space.ID,
		[]MessageSpan{{Type: "text", Text: "Visible to every Space member"}},
		nil,
	)
	if err != nil {
		t.Fatalf("CreateSpaceMessage(owner) error = %v", err)
	}
	if inbox, err := database.SpaceInbox(ctx, member.ID, "unreads", 20); err != nil || !containsInboxMessage(inbox, ownerMessage.ID) {
		t.Fatalf("SpaceInbox(member) = %#v, %v, want message %q", inbox, err, ownerMessage.ID)
	}
	events, _, err := database.SpaceEventsAfter(ctx, member.ID, 0, 500)
	if err != nil {
		t.Fatalf("SpaceEventsAfter(member) error = %v", err)
	}
	if !containsSpaceEvent(events, "message.created", memberMessage.ID) ||
		!containsSpaceEvent(events, "message.created", ownerMessage.ID) {
		t.Fatalf("member events = %#v, want both message events", events)
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
	space := createTestSpace(t, database, ctx, owner.ID, "Group conversations")
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
	space := createTestSpace(t, database, ctx, owner.ID, "Conversation updates")
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

func containsSpaceEvent(events []SpaceEvent, eventType, entityID string) bool {
	for _, event := range events {
		if event.EventType == eventType && event.EntityID == entityID {
			return true
		}
	}
	return false
}
