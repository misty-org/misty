package db

import (
	"context"
	"errors"
	"strings"
	"testing"
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
	if _, err := database.CreateSpace(ctx, owner.ID, "Fourth total"); !errors.Is(err, ErrSpaceOwnershipLimit) {
		t.Fatalf("CreateSpace(fourth total) error = %v, want ErrSpaceOwnershipLimit", err)
	}
	if err := database.DeleteSpace(ctx, owner.ID, secondAdditional.ID, secondAdditional.Name); err != nil {
		t.Fatalf("DeleteSpace(second additional) error = %v", err)
	}
	if _, err := database.CreateSpace(ctx, owner.ID, "Still fourth total"); !errors.Is(err, ErrSpaceOwnershipLimit) {
		t.Fatalf("CreateSpace while deletion pending error = %v, want ErrSpaceOwnershipLimit", err)
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
