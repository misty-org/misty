package db

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// eventTypesFor replays a user's visible events and returns the note event
// types that reached them for one note.
func noteEventTypesFor(t *testing.T, database *Database, ctx context.Context, userID, noteID string) []string {
	t.Helper()
	events, _, err := database.SpaceEventsAfter(ctx, userID, 0, 500)
	if err != nil {
		t.Fatal(err)
	}
	types := []string{}
	for _, event := range events {
		if event.EntityID == noteID && strings.HasPrefix(event.EventType, "note.") {
			types = append(types, event.EventType)
		}
	}
	return types
}

// A note.created event must not leak to the Space the way library or task
// events do. Without an explicit rule the shared visibility switch would fall
// through to its permissive default.
func TestNoteEventsDoNotReachTheWholeSpace(t *testing.T) {
	fixture := newNoteFixture(t, "note-event-private")

	creatorEvents := noteEventTypesFor(t, fixture.database, fixture.ctx, fixture.creator, fixture.note.ID)
	if len(creatorEvents) == 0 {
		t.Fatal("the creator received no note events at all")
	}

	for name, userID := range map[string]string{"space owner": fixture.owner, "ungranted member": fixture.member} {
		if got := noteEventTypesFor(t, fixture.database, fixture.ctx, userID, fixture.note.ID); len(got) != 0 {
			t.Fatalf("%s received note events %v, want none", name, got)
		}
	}
}

// Live delivery uses EventByIDForUser, replay uses SpaceEventsAfter. Both must
// apply the same rule, or a user could see through one path what the other
// hides.
func TestNoteEventVisibilityMatchesOnLiveDeliveryAndReplay(t *testing.T) {
	fixture := newNoteFixture(t, "note-event-paths")

	events, _, err := fixture.database.SpaceEventsAfter(fixture.ctx, fixture.creator, 0, 500)
	if err != nil {
		t.Fatal(err)
	}
	var noteEventID int64
	for _, event := range events {
		if event.EntityID == fixture.note.ID {
			noteEventID = event.ID
			break
		}
	}
	if noteEventID == 0 {
		t.Fatal("no note event was recorded for the creator")
	}

	if _, err := fixture.database.EventByIDForUser(fixture.ctx, fixture.creator, noteEventID); err != nil {
		t.Fatalf("creator live delivery = %v, want the event", err)
	}
	for name, userID := range map[string]string{"space owner": fixture.owner, "ungranted member": fixture.member} {
		if _, err := fixture.database.EventByIDForUser(fixture.ctx, userID, noteEventID); !errors.Is(err, ErrSpaceNotFound) {
			t.Fatalf("%s live delivery = %v, want ErrSpaceNotFound", name, err)
		}
	}
}

func TestGrantedMemberReceivesNoteEvents(t *testing.T) {
	fixture := newNoteFixture(t, "note-event-granted")

	if _, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleViewer}}); err != nil {
		t.Fatal(err)
	}

	got := noteEventTypesFor(t, fixture.database, fixture.ctx, fixture.member, fixture.note.ID)
	if len(got) == 0 {
		t.Fatal("a granted viewer received no note events")
	}
	// The grant is evaluated at delivery time, so the viewer now also sees the
	// earlier note.created event.
	sawPermissionsChanged := false
	for _, eventType := range got {
		if eventType == "note.permissions.changed" {
			sawPermissionsChanged = true
		}
	}
	if !sawPermissionsChanged {
		t.Fatalf("viewer events = %v, want note.permissions.changed", got)
	}

	// The Space owner still sees nothing.
	if owner := noteEventTypesFor(t, fixture.database, fixture.ctx, fixture.owner, fixture.note.ID); len(owner) != 0 {
		t.Fatalf("Space owner received note events %v after an unrelated grant", owner)
	}
}

// Visibility is resolved from the grant that exists now, not the one that
// existed when the event was written.
func TestRevokedUserLosesAccessToPastNoteEvents(t *testing.T) {
	fixture := newNoteFixture(t, "note-event-revoked")

	if _, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleEditor}}); err != nil {
		t.Fatal(err)
	}
	if got := noteEventTypesFor(t, fixture.database, fixture.ctx, fixture.member, fixture.note.ID); len(got) == 0 {
		t.Fatal("test precondition failed: granted editor saw no events")
	}

	if _, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID, nil); err != nil {
		t.Fatal(err)
	}

	if got := noteEventTypesFor(t, fixture.database, fixture.ctx, fixture.member, fixture.note.ID); len(got) != 0 {
		t.Fatalf("revoked user replayed note events %v, want none", got)
	}
}

// Archiving must still reach the people who had access, or their clients would
// keep showing a note they can no longer open.
func TestArchiveEventStillReachesFormerAudience(t *testing.T) {
	fixture := newNoteFixture(t, "note-event-archive")

	if _, _, err := fixture.database.ReplaceNoteGrants(fixture.ctx, fixture.creator, fixture.note.ID,
		[]NoteGrant{{UserID: fixture.member, Role: NoteRoleViewer}}); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.database.Conn.Exec(
		`UPDATE space_notes SET lifecycle_state='archived_creator_left',archived_at=NOW(),purge_after=NOW()+INTERVAL '30 days' WHERE id=$1`,
		fixture.note.ID); err != nil {
		t.Fatal(err)
	}

	// NoteAccessFor now denies everyone, but the event stream must not go dark
	// for the creator and the grantee.
	access, err := fixture.database.NoteAccessFor(fixture.ctx, fixture.creator, fixture.note.ID)
	if err != nil {
		t.Fatal(err)
	}
	if access.CanView {
		t.Fatal("test precondition failed: archived note is still viewable")
	}
	for name, userID := range map[string]string{"creator": fixture.creator, "viewer": fixture.member} {
		if got := noteEventTypesFor(t, fixture.database, fixture.ctx, userID, fixture.note.ID); len(got) == 0 {
			t.Fatalf("%s lost note event visibility once the note was archived", name)
		}
	}
	if owner := noteEventTypesFor(t, fixture.database, fixture.ctx, fixture.owner, fixture.note.ID); len(owner) != 0 {
		t.Fatalf("Space owner received archived-note events %v, want none", owner)
	}
}

func TestNoteEventPayloadsCarryNoContent(t *testing.T) {
	fixture := newNoteFixture(t, "note-event-payload")

	events, _, err := fixture.database.SpaceEventsAfter(fixture.ctx, fixture.creator, 0, 500)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, event := range events {
		if event.EntityID != fixture.note.ID {
			continue
		}
		found = true
		payload := string(event.Payload)
		// The note title is document content and must never ride along in a
		// Space event, which is stored durably and replayed.
		if strings.Contains(payload, "Beta launch checklist") {
			t.Fatalf("note event payload leaked the title: %s", payload)
		}
		if !strings.Contains(payload, fixture.note.ID) {
			t.Fatalf("note event payload is missing its note id: %s", payload)
		}
	}
	if !found {
		t.Fatal("no note events were recorded")
	}
}
