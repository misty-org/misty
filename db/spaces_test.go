package db

import (
	"context"
	"errors"
	"testing"
)

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
	if len(ownerSpaces) != 1 || !ownerSpaces[0].IsPersonal || ownerSpaces[0].IsShared || ownerSpaces[0].MemberCount != 1 {
		t.Fatalf("initial owner Spaces = %#v, want one private Personal Space", ownerSpaces)
	}
	personal := ownerSpaces[0]

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
	if _, err := database.CreateSpace(ctx, owner.ID, "Another"); !errors.Is(err, ErrSpaceLimit) {
		t.Fatalf("CreateSpace(second additional) error = %v, want ErrSpaceLimit", err)
	}

	memberSpaces, err := database.ListSpaces(ctx, member.ID)
	if err != nil || len(memberSpaces) != 1 || !memberSpaces[0].IsPersonal {
		t.Fatalf("ListSpaces(member) = %#v, %v, want default Personal Space", memberSpaces, err)
	}

	invite, err := database.InviteToSpace(ctx, owner.ID, personal.ID, member.Email)
	if err != nil {
		t.Fatalf("InviteToSpace(Personal) error = %v", err)
	}
	personalAfterInvite, err := database.SpaceByID(ctx, owner.ID, personal.ID)
	if err != nil || !personalAfterInvite.IsShared || personalAfterInvite.PendingCount != 1 {
		t.Fatalf("Personal after invite = %#v, %v, want shared with one pending", personalAfterInvite, err)
	}
	if _, err := database.InviteToSpace(ctx, owner.ID, additional.ID, member.Email); !errors.Is(err, ErrSpaceLimit) {
		t.Fatalf("InviteToSpace(second owned Space) error = %v, want ErrSpaceLimit", err)
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
