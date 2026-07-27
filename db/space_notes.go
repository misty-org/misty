package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
)

// Note lifecycle states.
const (
	NoteLifecycleActive              = "active"
	NoteLifecycleArchived            = "archived"
	NoteLifecycleArchivedCreatorLeft = "archived_creator_left"
	NoteLifecycleDeleting            = "deleting"
)

// Note roles. The creator's role is implicit and never stored.
const (
	NoteRoleCreator = "creator"
	NoteRoleEditor  = "editor"
	NoteRoleViewer  = "viewer"
)

// NoteAccess is the single answer to "what may this user do with this note".
// Every note handler must obtain it from NoteAccessFor rather than deriving
// capabilities itself, so the creator-only-administrator rule cannot drift
// between call sites.
type NoteAccess struct {
	CanView   bool
	CanEdit   bool
	CanDelete bool
	Role      string
}

// noteAccessDenied is the response for every unauthorized case. It is
// deliberately identical whether the note is missing, archived, or simply not
// shared with the caller, so an unauthorized caller cannot distinguish them.
var noteAccessDenied = NoteAccess{}

// NoteAccessFor resolves a caller's capabilities for one note.
//
// Every current Space member may view and edit a native note. The creator and
// Space owner may archive/delete it. There is no per-note ACL in beta.
func (db *Database) NoteAccessFor(ctx context.Context, userID, noteID string) (NoteAccess, error) {
	var access NoteAccess
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var innerErr error
		access, innerErr = noteAccessForTx(ctx, tx, userID, noteID)
		return innerErr
	})
	return access, err
}

func noteAccessForTx(ctx context.Context, tx *sql.Tx, userID, noteID string) (NoteAccess, error) {
	if userID == "" || noteID == "" {
		return noteAccessDenied, nil
	}
	var creatorUserID, spaceID, lifecycle string
	err := tx.QueryRowContext(ctx,
		`SELECT creator_user_id,space_id,lifecycle_state FROM space_notes WHERE id=$1`,
		noteID).Scan(&creatorUserID, &spaceID, &lifecycle)
	if errors.Is(err, sql.ErrNoRows) {
		return noteAccessDenied, nil
	}
	if err != nil {
		return noteAccessDenied, err
	}
	role, err := requireSpaceMemberTx(ctx, tx, spaceID, userID)
	if err != nil {
		if errors.Is(err, ErrSpaceForbidden) {
			return noteAccessDenied, nil
		}
		return noteAccessDenied, err
	}
	isCreator := userID == creatorUserID
	isOwner := role == "owner"
	if lifecycle != NoteLifecycleActive {
		if lifecycle == NoteLifecycleArchived && (isCreator || isOwner) {
			return NoteAccess{CanDelete: true, Role: NoteRoleCreator}, nil
		}
		return noteAccessDenied, nil
	}
	if isCreator {
		return NoteAccess{CanView: true, CanEdit: true, CanDelete: true, Role: NoteRoleCreator}, nil
	}
	access := NoteAccess{CanView: true, CanEdit: true, Role: NoteRoleEditor}
	if isOwner {
		access.CanDelete = true
	}
	return access, nil
}

// noteEventVisibleToUserTx decides whether one note.* realtime event may be
// delivered to or replayed for a user.
//
// This deliberately differs from NoteAccessFor in one way: it does not consult
// lifecycle state. A note.archived event exists precisely to tell the creator
// and grantees that the note went away, and checking "can view" would suppress
// exactly the event they need in order to drop it from their list.
//
// It fails closed. Once the row is hard-deleted a note.deleted event still
// inside the replay window resolves to nobody; those clients refetch their
// list on reconnect and simply will not see the note.
func noteEventVisibleToUserTx(ctx context.Context, tx *sql.Tx, userID string, event SpaceEvent) (bool, error) {
	if event.EntityID == "" {
		return false, nil
	}
	var creatorUserID, spaceID string
	err := tx.QueryRowContext(ctx,
		`SELECT creator_user_id,space_id FROM space_notes WHERE id=$1`,
		event.EntityID).Scan(&creatorUserID, &spaceID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	// The event's own Space must match the note's, so a stale or forged
	// entity ID cannot pull a note's events into another Space's stream.
	if spaceID != event.SpaceID {
		return false, nil
	}
	// A former member loses visibility even while a stale grant row survives.
	if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
		if errors.Is(err, ErrSpaceForbidden) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// recordNoteEventTx records a note.* Space event.
//
// The payload carries IDs and safe metadata only. It never contains note
// content, Yjs updates, or the grant set: the same bytes reach every
// authorized recipient, so anything in here is visible to all of them.
func recordNoteEventTx(ctx context.Context, tx *sql.Tx, spaceID, actorUserID, eventType, noteID string, extra map[string]any) error {
	payload := map[string]any{"note_id": noteID}
	for key, value := range extra {
		payload[key] = value
	}
	_, err := recordSpaceEventTx(ctx, tx, spaceID, actorUserID, eventType, noteID, payload)
	return err
}

// SpaceNote is the server-owned metadata for one collaborative note. The
// document body lives only in the collaboration service; the projections here
// exist for listing and search.
type SpaceNote struct {
	ID                    string `json:"id"`
	SpaceID               string `json:"space_id"`
	CreatorUserID         string `json:"creator_user_id"`
	TitleProjection       string `json:"title"`
	PlainTextProjection   string `json:"plain_text,omitempty"`
	LifecycleState        string `json:"lifecycle_state"`
	CollaborationRevision int64  `json:"collaboration_revision"`
	ACLVersion            int64  `json:"acl_version"`
	// Role is the caller's own effective role. A non-creator never receives the
	// full grant set, only this.
	Role string `json:"role"`
}

// CreateSpaceNote creates a note shared with every current Space member.
func (db *Database) CreateSpaceNote(ctx context.Context, creatorUserID, spaceID, title string) (*SpaceNote, error) {
	if creatorUserID == "" || spaceID == "" {
		return nil, ErrSpaceInvalid
	}
	note := &SpaceNote{
		ID: "note_" + uuid.NewString(), SpaceID: spaceID, CreatorUserID: creatorUserID,
		TitleProjection: title, LifecycleState: NoteLifecycleActive, ACLVersion: 1, Role: NoteRoleCreator,
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, creatorUserID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO space_notes(id,space_id,creator_user_id,title_projection) VALUES($1,$2,$3,$4)`,
			note.ID, spaceID, creatorUserID, title); err != nil {
			return err
		}
		return recordNoteEventTx(ctx, tx, note.SpaceID, creatorUserID, "note.created", note.ID, nil)
	})
	if err != nil {
		return nil, err
	}
	return note, nil
}

// AccessibleSpaceNotes lists the active notes a caller may view in one Space.
func (db *Database) AccessibleSpaceNotes(ctx context.Context, userID, spaceID string) ([]SpaceNote, error) {
	notes := []SpaceNote{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx,
			`SELECT n.id,n.space_id,n.creator_user_id,n.title_projection,n.lifecycle_state,
			        n.collaboration_revision,n.acl_version,
			        CASE WHEN n.creator_user_id=$1 THEN 'creator' ELSE 'editor' END AS effective_role
			 FROM space_notes n
			 WHERE n.space_id=$2 AND n.lifecycle_state='active'
			 ORDER BY n.updated_at DESC`, userID, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var note SpaceNote
			if err := rows.Scan(&note.ID, &note.SpaceID, &note.CreatorUserID, &note.TitleProjection,
				&note.LifecycleState, &note.CollaborationRevision, &note.ACLVersion, &note.Role); err != nil {
				return err
			}
			notes = append(notes, note)
		}
		return rows.Err()
	})
	return notes, err
}

// SpaceNoteByID returns one note the caller may view, with the caller's own
// effective role attached. Any caller who cannot view it gets ErrSpaceNotFound.
func (db *Database) SpaceNoteByID(ctx context.Context, userID, noteID string) (*SpaceNote, error) {
	note := &SpaceNote{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		access, err := noteAccessForTx(ctx, tx, userID, noteID)
		if err != nil {
			return err
		}
		if !access.CanView {
			return ErrSpaceNotFound
		}
		note.Role = access.Role
		return tx.QueryRowContext(ctx,
			`SELECT id,space_id,creator_user_id,title_projection,plain_text_projection,
			        lifecycle_state,collaboration_revision,acl_version
			 FROM space_notes WHERE id=$1`, noteID).Scan(
			&note.ID, &note.SpaceID, &note.CreatorUserID, &note.TitleProjection,
			&note.PlainTextProjection, &note.LifecycleState, &note.CollaborationRevision, &note.ACLVersion)
	})
	if err != nil {
		return nil, err
	}
	return note, nil
}

// UpdateNoteSharedTags replaces the server-owned tag list.
//
// Tags are deliberately not part of the CRDT: they are Space metadata rather
// than document content, so they are edited here rather than through the
// collaborative document. Any editor may change them.
func (db *Database) UpdateNoteSharedTags(ctx context.Context, userID, noteID string, tags []string) error {
	if tags == nil {
		tags = []string{}
	}
	if len(tags) > 50 {
		return ErrSpaceInvalid
	}
	for _, tag := range tags {
		if tag == "" || len(tag) > 80 {
			return ErrSpaceInvalid
		}
	}
	raw, err := json.Marshal(tags)
	if err != nil {
		return err
	}
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		access, err := noteAccessForTx(ctx, tx, userID, noteID)
		if err != nil {
			return err
		}
		if !access.CanEdit {
			// A viewer must not be able to tell an editable note from a
			// nonexistent one by the error it gets back.
			return ErrSpaceNotFound
		}
		var spaceID string
		if err := tx.QueryRowContext(ctx,
			`UPDATE space_notes SET shared_tags=$1,updated_at=NOW() WHERE id=$2 RETURNING space_id`,
			raw, noteID).Scan(&spaceID); err != nil {
			return err
		}
		return recordNoteEventTx(ctx, tx, spaceID, userID, "note.projection.updated", noteID, nil)
	})
}

// SetSpaceNoteArchived archives or restores a note. Only its creator or the
// Space owner may change this lifecycle state.
func (db *Database) SetSpaceNoteArchived(ctx context.Context, userID, noteID string, archived bool) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		var creatorUserID, spaceID, lifecycle string
		if err := tx.QueryRowContext(ctx,
			`SELECT creator_user_id,space_id,lifecycle_state FROM space_notes WHERE id=$1 FOR UPDATE`,
			noteID).Scan(&creatorUserID, &spaceID, &lifecycle); err != nil {
			return ErrSpaceNotFound
		}
		role, err := requireSpaceMemberTx(ctx, tx, spaceID, userID)
		if err != nil || (userID != creatorUserID && role != "owner") {
			return ErrSpaceNotFound
		}
		target := NoteLifecycleActive
		eventType := "note.restored"
		if archived {
			target = NoteLifecycleArchived
			eventType = "note.archived"
		}
		if lifecycle == target {
			return nil
		}
		if lifecycle != NoteLifecycleActive && lifecycle != NoteLifecycleArchived {
			return ErrSpaceNotFound
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_notes
			SET lifecycle_state=$1,archived_at=CASE WHEN $1='archived' THEN NOW() ELSE NULL END,
			    purge_after=NULL,updated_at=NOW()
			WHERE id=$2`, target, noteID); err != nil {
			return err
		}
		return recordNoteEventTx(ctx, tx, spaceID, userID, eventType, noteID, nil)
	})
}

// DeleteSpaceNote begins hard deletion. It is creator/owner-only and idempotent: a
// retried request against an already-deleting note succeeds without a second
// event, so a client that times out and retries does not see a conflict.
//
// The row moves to 'deleting' rather than being removed here. The collaboration
// room and R2 assets must be purged first, and keeping the row until then is
// also what lets the note.deleted event resolve its audience.
func (db *Database) DeleteSpaceNote(ctx context.Context, userID, noteID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		access, err := noteAccessForTx(ctx, tx, userID, noteID)
		if err != nil {
			return err
		}
		if !access.CanDelete {
			// Covers ordinary members and a genuinely missing
			// note with one indistinguishable answer.
			if lifecycle, lookupErr := noteLifecycleTx(ctx, tx, noteID); lookupErr != nil {
				return lookupErr
			} else if lifecycle == NoteLifecycleDeleting {
				// Already deleting: the creator's retry lands here because
				// NoteAccessFor denies non-active notes.
				if allowed, actorErr := noteDestructiveActorTx(ctx, tx, noteID, userID); actorErr != nil {
					return actorErr
				} else if allowed {
					return nil
				}
			}
			return ErrSpaceNotFound
		}
		var spaceID string
		if err := tx.QueryRowContext(ctx,
			`UPDATE space_notes SET lifecycle_state=$1,acl_version=acl_version+1,updated_at=NOW()
			 WHERE id=$2 AND lifecycle_state IN ($3,$4) RETURNING space_id`,
			NoteLifecycleDeleting, noteID, NoteLifecycleActive, NoteLifecycleArchived).Scan(&spaceID); err != nil {
			return err
		}
		if err := recordNoteEventTx(ctx, tx, spaceID, userID, "note.deleted", noteID, nil); err != nil {
			return err
		}
		// The room must be torn down even if the control call fails right now,
		// so the command is queued rather than issued inline.
		return enqueueNoteControlTx(ctx, tx, noteID, "purge", nil)
	})
}

func noteLifecycleTx(ctx context.Context, tx *sql.Tx, noteID string) (string, error) {
	var lifecycle string
	err := tx.QueryRowContext(ctx, `SELECT lifecycle_state FROM space_notes WHERE id=$1`, noteID).Scan(&lifecycle)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return lifecycle, err
}

func noteCreatorTx(ctx context.Context, tx *sql.Tx, noteID string) (string, error) {
	var creator string
	err := tx.QueryRowContext(ctx, `SELECT creator_user_id FROM space_notes WHERE id=$1`, noteID).Scan(&creator)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return creator, err
}

func noteDestructiveActorTx(
	ctx context.Context,
	tx *sql.Tx,
	noteID, userID string,
) (bool, error) {
	var creatorUserID, spaceID string
	if err := tx.QueryRowContext(ctx,
		`SELECT creator_user_id,space_id FROM space_notes WHERE id=$1`,
		noteID).Scan(&creatorUserID, &spaceID); err != nil {
		return false, err
	}
	role, err := requireSpaceMemberTx(ctx, tx, spaceID, userID)
	if err != nil {
		return false, err
	}
	return creatorUserID == userID || role == "owner", nil
}

// enqueueNoteControlTx queues a command for the collaboration service. Delivery
// is the outbox worker's job, so an unreachable service can never block or roll
// back the authorization transaction that produced the command.
func enqueueNoteControlTx(ctx context.Context, tx *sql.Tx, noteID, command string, payload map[string]any) error {
	if payload == nil {
		payload = map[string]any{}
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO space_note_control_outbox(id,note_id,command,payload) VALUES($1,$2,$3,$4)`,
		"notectl_"+uuid.NewString(), noteID, command, raw)
	return err
}

// RequireNoteView returns ErrSpaceNotFound for any caller who cannot view the
// note. Callers must surface it as a plain not-found: the title, creator,
// timestamps, asset names, and even the note's existence stay hidden.
func (db *Database) RequireNoteView(ctx context.Context, userID, noteID string) (NoteAccess, error) {
	access, err := db.NoteAccessFor(ctx, userID, noteID)
	if err != nil {
		return noteAccessDenied, err
	}
	if !access.CanView {
		return noteAccessDenied, ErrSpaceNotFound
	}
	return access, nil
}
