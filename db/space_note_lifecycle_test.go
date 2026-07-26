package db

import (
	"context"
	"testing"
)

func noteLifecycleState(t *testing.T, fixture noteFixture, noteID string) (string, bool) {
	t.Helper()
	var state string
	var hasPurge bool
	err := fixture.database.Conn.QueryRow(
		`SELECT lifecycle_state,purge_after IS NOT NULL FROM space_notes WHERE id=$1`, noteID).Scan(&state, &hasPurge)
	if err != nil {
		t.Fatalf("reading lifecycle for %s: %v", noteID, err)
	}
	return state, hasPurge
}

func rejoinSpace(t *testing.T, fixture noteFixture, userID string) {
	t.Helper()
	invite, err := fixture.database.InviteToSpace(fixture.ctx, fixture.owner, fixture.spaceID, userEmail(t, fixture.database, userID))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.database.RespondToSpaceInvite(fixture.ctx, userID, invite.ID, true); err != nil {
		t.Fatal(err)
	}
}

// A creator leaving archives their notes rather than deleting them, in the same
// transaction as the membership change.
func TestCreatorLeavingArchivesTheirNotes(t *testing.T) {
	fixture := newNoteFixture(t, "note-life-leave")
	if _, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleEditor}}); err != nil {
		t.Fatal(err)
	}

	if err := fixture.database.LeaveSpace(fixture.ctx, fixture.creator, fixture.spaceID); err != nil {
		t.Fatal(err)
	}

	state, hasPurge := noteLifecycleState(t, fixture, fixture.note.ID)
	if state != NoteLifecycleArchivedCreatorLeft || !hasPurge {
		t.Fatalf("lifecycle = %q purge_after set = %v, want archived with a deadline", state, hasPurge)
	}
	// Archived notes are inaccessible to everyone, including the prior editor.
	for name, userID := range map[string]string{"prior editor": fixture.member, "space owner": fixture.owner} {
		access, err := fixture.database.NoteAccessFor(fixture.ctx, userID, fixture.note.ID)
		if err != nil {
			t.Fatal(err)
		}
		if access.CanView {
			t.Fatalf("%s could still view an archived note: %#v", name, access)
		}
	}
}

// Removal by the owner must behave identically to leaving voluntarily.
func TestCreatorRemovedArchivesTheirNotes(t *testing.T) {
	fixture := newNoteFixture(t, "note-life-removed")

	if err := fixture.database.RemoveSpaceMember(fixture.ctx, fixture.owner, fixture.spaceID, fixture.creator); err != nil {
		t.Fatal(err)
	}

	state, hasPurge := noteLifecycleState(t, fixture, fixture.note.ID)
	if state != NoteLifecycleArchivedCreatorLeft || !hasPurge {
		t.Fatalf("lifecycle = %q purge_after set = %v, want archived with a deadline", state, hasPurge)
	}
}

// Rejoining inside the window restores the notes and their surviving grants.
func TestCreatorRejoiningRestoresNotes(t *testing.T) {
	fixture := newNoteFixture(t, "note-life-rejoin")
	if _, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleEditor}}); err != nil {
		t.Fatal(err)
	}
	if err := fixture.database.LeaveSpace(fixture.ctx, fixture.creator, fixture.spaceID); err != nil {
		t.Fatal(err)
	}

	rejoinSpace(t, fixture, fixture.creator)

	state, hasPurge := noteLifecycleState(t, fixture, fixture.note.ID)
	if state != NoteLifecycleActive || hasPurge {
		t.Fatalf("lifecycle = %q purge_after set = %v, want active with no deadline", state, hasPurge)
	}
	access, err := fixture.database.NoteAccessFor(fixture.ctx, fixture.creator, fixture.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !access.CanManageACL {
		t.Fatalf("restored creator access = %#v, want full capabilities", access)
	}
	// The grant to a member who is still present survives.
	editor, err := fixture.database.NoteAccessFor(fixture.ctx, fixture.member, fixture.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !editor.CanEdit {
		t.Fatalf("surviving editor grant = %#v, want edit access", editor)
	}
}

// A grantee who left while the note was archived must not silently regain
// access when the creator returns.
func TestRestoreDropsGrantsForMembersWhoLeftMeanwhile(t *testing.T) {
	fixture := newNoteFixture(t, "note-life-prune")
	if _, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleEditor}}); err != nil {
		t.Fatal(err)
	}
	if err := fixture.database.LeaveSpace(fixture.ctx, fixture.creator, fixture.spaceID); err != nil {
		t.Fatal(err)
	}
	if err := fixture.database.LeaveSpace(fixture.ctx, fixture.member, fixture.spaceID); err != nil {
		t.Fatal(err)
	}

	rejoinSpace(t, fixture, fixture.creator)
	rejoinSpace(t, fixture, fixture.member)

	access, err := fixture.database.NoteAccessFor(fixture.ctx, fixture.member, fixture.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if access.CanView {
		t.Fatalf("a member who left and rejoined silently regained note access: %#v", access)
	}
}

// A non-creator leaving loses their grants outright; the note itself is
// untouched and stays active for its creator.
func TestOtherMemberLeavingDropsOnlyTheirGrants(t *testing.T) {
	fixture := newNoteFixture(t, "note-life-other")
	if _, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleEditor}}); err != nil {
		t.Fatal(err)
	}

	if err := fixture.database.LeaveSpace(fixture.ctx, fixture.member, fixture.spaceID); err != nil {
		t.Fatal(err)
	}

	state, _ := noteLifecycleState(t, fixture, fixture.note.ID)
	if state != NoteLifecycleActive {
		t.Fatalf("lifecycle = %q, want the note to stay active", state)
	}
	creator, err := fixture.database.NoteAccessFor(fixture.ctx, fixture.creator, fixture.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !creator.CanEdit {
		t.Fatalf("creator lost access when an unrelated member left: %#v", creator)
	}
	var grants int
	if err := fixture.database.Conn.QueryRow(
		`SELECT COUNT(*) FROM space_note_permissions WHERE note_id=$1 AND user_id=$2`,
		fixture.note.ID, fixture.member).Scan(&grants); err != nil {
		t.Fatal(err)
	}
	if grants != 0 {
		t.Fatalf("departed member still holds %d grant rows", grants)
	}
}

// Leaving queues a room disconnect so a live collaboration session cannot keep
// reading after access is gone.
func TestMembershipLossQueuesRoomCommands(t *testing.T) {
	fixture := newNoteFixture(t, "note-life-outbox")

	if err := fixture.database.LeaveSpace(fixture.ctx, fixture.creator, fixture.spaceID); err != nil {
		t.Fatal(err)
	}

	var queued int
	if err := fixture.database.Conn.QueryRow(
		`SELECT COUNT(*) FROM space_note_control_outbox WHERE note_id=$1 AND command='disconnect' AND delivered_at IS NULL`,
		fixture.note.ID).Scan(&queued); err != nil {
		t.Fatal(err)
	}
	if queued == 0 {
		t.Fatal("no disconnect command was queued for the archived note's room")
	}
}

// Retention deletes archived notes only after the window has actually passed.
func TestPurgeRemovesOnlyExpiredArchivedNotes(t *testing.T) {
	fixture := newNoteFixture(t, "note-life-purge")
	if err := fixture.database.LeaveSpace(fixture.ctx, fixture.creator, fixture.spaceID); err != nil {
		t.Fatal(err)
	}

	// Still inside the 30-day window.
	if _, err := fixture.database.PurgeExpiredNotes(fixture.ctx, 100); err != nil {
		t.Fatal(err)
	}
	if state, _ := noteLifecycleState(t, fixture, fixture.note.ID); state != NoteLifecycleArchivedCreatorLeft {
		t.Fatalf("lifecycle = %q, want the note to survive inside its window", state)
	}

	// Shorten the window the way the release-gate test would.
	if _, err := fixture.database.Conn.Exec(
		`UPDATE space_notes SET purge_after=NOW()-INTERVAL '1 minute' WHERE id=$1`, fixture.note.ID); err != nil {
		t.Fatal(err)
	}
	purged, err := fixture.database.PurgeExpiredNotes(fixture.ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	if purged != 1 {
		t.Fatalf("purged = %d, want 1", purged)
	}
	var remaining int
	if err := fixture.database.Conn.QueryRow(
		`SELECT COUNT(*) FROM space_notes WHERE id=$1`, fixture.note.ID).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatal("the expired note survived its purge")
	}
}

// A note marked deleting must not be removed until its room purge is actually
// delivered, or the Durable Object would be stranded with no record of it.
func TestPurgeWaitsForRoomPurgeDelivery(t *testing.T) {
	fixture := newNoteFixture(t, "note-life-delivery")
	if err := fixture.database.DeleteSpaceNote(fixture.ctx, fixture.creator, fixture.note.ID); err != nil {
		t.Fatal(err)
	}

	if _, err := fixture.database.PurgeExpiredNotes(fixture.ctx, 100); err != nil {
		t.Fatal(err)
	}
	if state, _ := noteLifecycleState(t, fixture, fixture.note.ID); state != NoteLifecycleDeleting {
		t.Fatalf("lifecycle = %q, want the note held until its room purge lands", state)
	}

	commands, err := fixture.database.PendingNoteControlCommands(fixture.ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	var purgeCommandID string
	for _, command := range commands {
		if command.NoteID == fixture.note.ID && command.Command == "purge" {
			purgeCommandID = command.ID
		}
	}
	if purgeCommandID == "" {
		t.Fatal("no purge command was queued for the deleted note")
	}
	if err := fixture.database.MarkNoteControlDelivered(fixture.ctx, purgeCommandID); err != nil {
		t.Fatal(err)
	}

	purged, err := fixture.database.PurgeExpiredNotes(fixture.ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	if purged != 1 {
		t.Fatalf("purged = %d, want the note removed once its room purge was delivered", purged)
	}
}

// Two workers must not deliver the same command twice.
func TestPendingControlCommandsAreClaimedOnce(t *testing.T) {
	fixture := newNoteFixture(t, "note-life-claim")
	if err := fixture.database.DeleteSpaceNote(fixture.ctx, fixture.creator, fixture.note.ID); err != nil {
		t.Fatal(err)
	}

	first, err := fixture.database.PendingNoteControlCommands(fixture.ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) == 0 {
		t.Fatal("no commands were claimed")
	}
	// The backoff pushes the next attempt out, so an immediate second poll
	// gets nothing.
	second, err := fixture.database.PendingNoteControlCommands(fixture.ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, command := range second {
		for _, claimed := range first {
			if command.ID == claimed.ID {
				t.Fatalf("command %s was claimed twice in a row", command.ID)
			}
		}
	}
}

// Account deletion is immediate and permanent: no 30-day window, and nothing is
// transferred to the Space owner.
func TestAccountDeletionMarksEveryCreatedNoteForPurge(t *testing.T) {
	fixture := newNoteFixture(t, "note-life-account")
	second, err := fixture.database.CreateSpaceNote(fixture.ctx, fixture.creator, fixture.spaceID, "Second note")
	if err != nil {
		t.Fatal(err)
	}

	if err := fixture.database.PurgeNotesForDeletedAccount(fixture.ctx, fixture.creator); err != nil {
		t.Fatal(err)
	}

	for _, noteID := range []string{fixture.note.ID, second.ID} {
		state, hasPurge := noteLifecycleState(t, fixture, noteID)
		if state != NoteLifecycleDeleting {
			t.Fatalf("lifecycle for %s = %q, want deleting", noteID, state)
		}
		if hasPurge {
			t.Fatalf("note %s got a retention deadline; account deletion is immediate", noteID)
		}
	}
	// The Space owner must not inherit anything.
	notes, err := fixture.database.AccessibleSpaceNotes(fixture.ctx, fixture.owner, fixture.spaceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(notes) != 0 {
		t.Fatalf("Space owner inherited %d notes from a deleted account", len(notes))
	}
}

func TestNoteControlBacklogCountsOnlyDueUndelivered(t *testing.T) {
	fixture := newNoteFixture(t, "note-life-backlog")
	ctx := context.Background()

	before, err := fixture.database.NoteControlBacklog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.database.DeleteSpaceNote(fixture.ctx, fixture.creator, fixture.note.ID); err != nil {
		t.Fatal(err)
	}
	after, err := fixture.database.NoteControlBacklog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if after <= before {
		t.Fatalf("backlog = %d, want it to grow past %d after queuing a purge", after, before)
	}
}
