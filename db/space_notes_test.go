package db

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type noteFixture struct {
	database *Database
	ctx      context.Context
	spaceID  string
	creator  string
	member   string
	owner    string
	note     *SpaceNote
}

// newNoteFixture builds a Space owned by `owner`, joined by `creator` and
// `member`, with one note created by `creator`.
//
// The owner is deliberately a different user from the note creator so every
// test can assert that Space ownership grants no note access.
func newNoteFixture(t *testing.T, prefix string) noteFixture {
	t.Helper()
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Note Owner", prefix+"-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	creator, err := database.CreateUser("Note Creator", prefix+"-creator@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	member, err := database.CreateUser("Note Member", prefix+"-member@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	space, err := database.CreateSpace(ctx, owner.ID, "Note Space")
	if err != nil {
		t.Fatal(err)
	}
	for _, user := range []string{creator.ID, member.ID} {
		invite, inviteErr := database.InviteToSpace(ctx, owner.ID, space.ID, userEmail(t, database, user))
		if inviteErr != nil {
			t.Fatal(inviteErr)
		}
		if _, respondErr := database.RespondToSpaceInvite(ctx, user, invite.ID, true); respondErr != nil {
			t.Fatal(respondErr)
		}
	}
	note, err := database.CreateSpaceNote(ctx, creator.ID, space.ID, "Beta launch checklist")
	if err != nil {
		t.Fatal(err)
	}
	return noteFixture{
		database: database, ctx: ctx, spaceID: space.ID,
		creator: creator.ID, member: member.ID, owner: owner.ID, note: note,
	}
}

func userEmail(t *testing.T, database *Database, userID string) string {
	t.Helper()
	var email string
	if err := database.Conn.QueryRow(`SELECT email FROM users WHERE id=$1`, userID).Scan(&email); err != nil {
		t.Fatal(err)
	}
	return email
}

func TestNewNoteIsPrivateToItsCreator(t *testing.T) {
	fixture := newNoteFixture(t, "note-private")

	creatorAccess, err := fixture.database.NoteAccessFor(fixture.ctx, fixture.creator, fixture.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !creatorAccess.CanView || !creatorAccess.CanEdit || !creatorAccess.CanManageACL || !creatorAccess.CanDelete {
		t.Fatalf("creator access = %#v, want full capabilities", creatorAccess)
	}
	if creatorAccess.Role != NoteRoleCreator {
		t.Fatalf("creator role = %q, want creator", creatorAccess.Role)
	}

	memberAccess, err := fixture.database.NoteAccessFor(fixture.ctx, fixture.member, fixture.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if memberAccess.CanView {
		t.Fatalf("a Space member without a grant could view a private note: %#v", memberAccess)
	}
}

// The Space owner is not a note administrator. This is the rule most likely to
// regress, because Space ownership overrides nearly everything else.
func TestSpaceOwnerHasNoNoteOverride(t *testing.T) {
	fixture := newNoteFixture(t, "note-owner")

	access, err := fixture.database.NoteAccessFor(fixture.ctx, fixture.owner, fixture.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if access.CanView || access.CanEdit || access.CanManageACL || access.CanDelete {
		t.Fatalf("Space owner access = %#v, want no capabilities", access)
	}

	// The owner must not be able to read or rewrite the grant set either.
	if _, err := fixture.database.NoteGrants(fixture.ctx, fixture.owner, fixture.note.ID); !errors.Is(err, ErrSpaceNotFound) {
		t.Fatalf("owner NoteGrants() = %v, want ErrSpaceNotFound", err)
	}
	_, _, err = fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.owner, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.owner, Role: NoteRoleEditor}})
	if !errors.Is(err, ErrSpaceNotFound) {
		t.Fatalf("owner ReplaceNoteGrants() = %v, want ErrSpaceNotFound", err)
	}

	// And the note must not appear in the owner's list.
	notes, err := fixture.database.AccessibleSpaceNotes(fixture.ctx, fixture.owner, fixture.spaceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(notes) != 0 {
		t.Fatalf("owner sees %d notes, want 0", len(notes))
	}
}

func TestViewerReadsAndEditorWrites(t *testing.T) {
	fixture := newNoteFixture(t, "note-roles")

	if _, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleViewer}}); err != nil {
		t.Fatal(err)
	}
	viewer, err := fixture.database.NoteAccessFor(fixture.ctx, fixture.member, fixture.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !viewer.CanView || viewer.CanEdit || viewer.CanManageACL || viewer.CanDelete {
		t.Fatalf("viewer access = %#v, want view only", viewer)
	}

	if _, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleEditor}}); err != nil {
		t.Fatal(err)
	}
	editor, err := fixture.database.NoteAccessFor(fixture.ctx, fixture.member, fixture.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !editor.CanView || !editor.CanEdit {
		t.Fatalf("editor access = %#v, want view and edit", editor)
	}
	// An editor is still not an administrator.
	if editor.CanManageACL || editor.CanDelete {
		t.Fatalf("editor access = %#v, want no ACL or delete capability", editor)
	}
}

func TestACLVersionIncrementsOnlyWhenTheEffectiveSetChanges(t *testing.T) {
	fixture := newNoteFixture(t, "note-aclversion")

	first, changed, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleViewer}})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || first <= fixture.note.ACLVersion {
		t.Fatalf("first grant: version %d changed %v, want an increment above %d", first, changed, fixture.note.ACLVersion)
	}

	// Saving the identical set must not disconnect live collaborators.
	second, changed, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleViewer}})
	if err != nil {
		t.Fatal(err)
	}
	if changed || second != first {
		t.Fatalf("unchanged save: version %d changed %v, want %d and false", second, changed, first)
	}

	third, changed, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || third <= second {
		t.Fatalf("revocation: version %d changed %v, want an increment above %d", third, changed, second)
	}
	access, err := fixture.database.NoteAccessFor(fixture.ctx, fixture.member, fixture.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if access.CanView {
		t.Fatal("a revoked user retained view access")
	}
}

func TestGrantTargetMustBeACurrentSpaceMember(t *testing.T) {
	fixture := newNoteFixture(t, "note-outsider")
	outsider, err := fixture.database.CreateUser("Outsider", "note-outsider-stranger@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}

	_, _, err = fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: outsider.ID, Role: NoteRoleViewer}})
	if err == nil {
		t.Fatal("ReplaceNoteGrants() granted access to a non-member")
	}
	if !strings.Contains(err.Error(), "current member") {
		t.Fatalf("error = %v, want the membership guard to reject it", err)
	}
}

// The creator's access is implicit; an explicit row would create a second
// source of truth that could be revoked.
func TestCreatorCannotHoldAPermissionRow(t *testing.T) {
	fixture := newNoteFixture(t, "note-implicit")

	_, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.creator, Role: NoteRoleViewer}})
	if err == nil {
		t.Fatal("ReplaceNoteGrants() stored a permission row for the creator")
	}
	if !strings.Contains(err.Error(), "implicit access") {
		t.Fatalf("error = %v, want the implicit-access guard to reject it", err)
	}

	// The creator keeps full access after the rejected write.
	access, err := fixture.database.NoteAccessFor(fixture.ctx, fixture.creator, fixture.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !access.CanManageACL {
		t.Fatalf("creator access after rejected write = %#v", access)
	}
}

// A former member must lose access even if a permission row survives the
// membership change.
func TestFormerSpaceMemberLosesAccessDespiteStaleGrant(t *testing.T) {
	fixture := newNoteFixture(t, "note-former")

	if _, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleEditor}}); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.database.Conn.Exec(`DELETE FROM space_members WHERE space_id=$1 AND user_id=$2`,
		fixture.spaceID, fixture.member); err != nil {
		t.Fatal(err)
	}

	// The stale grant row is deliberately left in place.
	var staleGrants int
	if err := fixture.database.Conn.QueryRow(`SELECT COUNT(*) FROM space_note_permissions WHERE note_id=$1 AND user_id=$2`,
		fixture.note.ID, fixture.member).Scan(&staleGrants); err != nil {
		t.Fatal(err)
	}
	if staleGrants != 1 {
		t.Fatalf("stale grant rows = %d, want the test precondition of 1", staleGrants)
	}

	access, err := fixture.database.NoteAccessFor(fixture.ctx, fixture.member, fixture.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if access.CanView {
		t.Fatalf("former member kept access through a stale grant: %#v", access)
	}
}

// Archived notes are inaccessible to everyone, including prior viewers and the
// creator, until they are restored.
func TestArchivedNoteIsInaccessibleToEveryone(t *testing.T) {
	fixture := newNoteFixture(t, "note-archived")

	if _, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleEditor}}); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.database.Conn.Exec(
		`UPDATE space_notes SET lifecycle_state='archived_creator_left',archived_at=NOW(),purge_after=NOW()+INTERVAL '30 days' WHERE id=$1`,
		fixture.note.ID); err != nil {
		t.Fatal(err)
	}

	for name, userID := range map[string]string{
		"creator": fixture.creator, "editor": fixture.member, "space owner": fixture.owner,
	} {
		access, err := fixture.database.NoteAccessFor(fixture.ctx, userID, fixture.note.ID)
		if err != nil {
			t.Fatal(err)
		}
		if access.CanView {
			t.Fatalf("%s could view an archived note: %#v", name, access)
		}
	}
}

// Unauthorized reads must be indistinguishable from a missing note.
func TestUnauthorizedNoteLooksExactlyLikeAMissingNote(t *testing.T) {
	fixture := newNoteFixture(t, "note-indistinct")

	unauthorized, err := fixture.database.RequireNoteView(fixture.ctx, fixture.owner, fixture.note.ID)
	if !errors.Is(err, ErrSpaceNotFound) {
		t.Fatalf("unauthorized RequireNoteView() = %v, want ErrSpaceNotFound", err)
	}
	missing, err := fixture.database.RequireNoteView(fixture.ctx, fixture.owner, "note_00000000-0000-0000-0000-000000000000")
	if !errors.Is(err, ErrSpaceNotFound) {
		t.Fatalf("missing RequireNoteView() = %v, want ErrSpaceNotFound", err)
	}
	// No field may differ, or the difference itself leaks the note's existence.
	if unauthorized != missing {
		t.Fatalf("unauthorized %#v differs from missing %#v", unauthorized, missing)
	}
}

func TestAccessibleNotesListsOnlyAuthorizedNotes(t *testing.T) {
	fixture := newNoteFixture(t, "note-list")
	other, err := fixture.database.CreateSpaceNote(fixture.ctx, fixture.member, fixture.spaceID, "Member's own note")
	if err != nil {
		t.Fatal(err)
	}

	creatorNotes, err := fixture.database.AccessibleSpaceNotes(fixture.ctx, fixture.creator, fixture.spaceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(creatorNotes) != 1 || creatorNotes[0].ID != fixture.note.ID {
		t.Fatalf("creator list = %#v, want only their own note", creatorNotes)
	}

	if _, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleViewer}}); err != nil {
		t.Fatal(err)
	}
	memberNotes, err := fixture.database.AccessibleSpaceNotes(fixture.ctx, fixture.member, fixture.spaceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(memberNotes) != 2 {
		t.Fatalf("member list = %#v, want their own note plus the shared one", memberNotes)
	}
	roles := map[string]string{}
	for _, note := range memberNotes {
		roles[note.ID] = note.Role
	}
	if roles[other.ID] != NoteRoleCreator || roles[fixture.note.ID] != NoteRoleViewer {
		t.Fatalf("effective roles = %#v", roles)
	}
}
