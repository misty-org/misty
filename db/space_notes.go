package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"

	"github.com/google/uuid"
)

// Note lifecycle states.
const (
	NoteLifecycleActive              = "active"
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
	CanView      bool
	CanEdit      bool
	CanManageACL bool
	CanDelete    bool
	Role         string
}

// noteAccessDenied is the response for every unauthorized case. It is
// deliberately identical whether the note is missing, archived, or simply not
// shared with the caller, so an unauthorized caller cannot distinguish them.
var noteAccessDenied = NoteAccess{}

// NoteAccessFor resolves a caller's capabilities for one note.
//
// Rules:
//   - Creator: view, edit, manage ACL, delete.
//   - Current Space member with an editor grant: view and edit.
//   - Current Space member with a viewer grant: view only.
//   - Space owner or admin without a grant: nothing. Space ownership is
//     deliberately not consulted.
//   - Former Space member: nothing, even if a stale permission row survives.
//   - Archived or deleting note: nothing, for everyone including the creator,
//     until it is restored.
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
	if lifecycle != NoteLifecycleActive {
		return noteAccessDenied, nil
	}
	// Membership is required for everyone, including the creator: a creator who
	// left the Space loses access even before the archive transaction lands.
	if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
		if errors.Is(err, ErrSpaceForbidden) {
			return noteAccessDenied, nil
		}
		return noteAccessDenied, err
	}
	if userID == creatorUserID {
		return NoteAccess{CanView: true, CanEdit: true, CanManageACL: true, CanDelete: true, Role: NoteRoleCreator}, nil
	}
	var role string
	err = tx.QueryRowContext(ctx,
		`SELECT role FROM space_note_permissions WHERE note_id=$1 AND user_id=$2`,
		noteID, userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		// No grant. A Space owner or admin lands here and is denied.
		return noteAccessDenied, nil
	}
	if err != nil {
		return noteAccessDenied, err
	}
	switch role {
	case NoteRoleEditor:
		return NoteAccess{CanView: true, CanEdit: true, Role: NoteRoleEditor}, nil
	case NoteRoleViewer:
		return NoteAccess{CanView: true, Role: NoteRoleViewer}, nil
	default:
		return noteAccessDenied, nil
	}
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
	if userID == creatorUserID {
		return true, nil
	}
	var granted bool
	if err := tx.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM space_note_permissions WHERE note_id=$1 AND user_id=$2)`,
		event.EntityID, userID).Scan(&granted); err != nil {
		return false, err
	}
	return granted, nil
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

// NoteGrant is one entry in a note's desired permission set.
type NoteGrant struct {
	UserID string `json:"user_id"`
	Role   string `json:"role"`
}

// CreateSpaceNote creates a note private to its creator. No permission rows are
// created: creator access is implicit.
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

// ReplaceNoteGrants atomically replaces a note's entire permission set.
//
// Only the creator may call it. Every recipient must be a current member of the
// note's Space, enforced both here and by the database trigger. acl_version is
// incremented only when the effective ACL actually changed, so an unchanged
// save does not needlessly disconnect live collaborators.
func (db *Database) ReplaceNoteGrants(ctx context.Context, actorUserID, noteID string, grants []NoteGrant) (int64, bool, error) {
	var aclVersion int64
	var changed bool
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		access, err := noteAccessForTx(ctx, tx, actorUserID, noteID)
		if err != nil {
			return err
		}
		if !access.CanManageACL {
			// Indistinguishable from a missing note for anyone but the creator,
			// including a Space owner.
			return ErrSpaceNotFound
		}
		// Lock the note so two concurrent saves cannot interleave.
		if err := tx.QueryRowContext(ctx,
			`SELECT acl_version FROM space_notes WHERE id=$1 FOR UPDATE`, noteID).Scan(&aclVersion); err != nil {
			return err
		}
		existing := map[string]string{}
		rows, err := tx.QueryContext(ctx, `SELECT user_id,role FROM space_note_permissions WHERE note_id=$1`, noteID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var userID, role string
			if err := rows.Scan(&userID, &role); err != nil {
				rows.Close()
				return err
			}
			existing[userID] = role
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		desired := map[string]string{}
		for _, grant := range grants {
			if grant.Role != NoteRoleViewer && grant.Role != NoteRoleEditor {
				return ErrSpaceInvalid
			}
			if grant.UserID == "" {
				return ErrSpaceInvalid
			}
			desired[grant.UserID] = grant.Role
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM space_note_permissions WHERE note_id=$1`, noteID); err != nil {
			return err
		}
		for userID, role := range desired {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO space_note_permissions(note_id,user_id,role,granted_by) VALUES($1,$2,$3,$4)`,
				noteID, userID, role, actorUserID); err != nil {
				return err
			}
		}
		// Favorites are UI state, not access: drop them for anyone who lost
		// access so a stale favorite cannot resurface a note they cannot open.
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM space_note_preferences p WHERE p.note_id=$1 AND p.user_id<>$2
			 AND NOT EXISTS(SELECT 1 FROM space_note_permissions g WHERE g.note_id=$1 AND g.user_id=p.user_id)`,
			noteID, actorUserID); err != nil {
			return err
		}
		changed = !sameGrantSet(existing, desired)
		if !changed {
			return nil
		}
		if err := tx.QueryRowContext(ctx,
			`UPDATE space_notes SET acl_version=acl_version+1,updated_at=NOW() WHERE id=$1 RETURNING acl_version`,
			noteID).Scan(&aclVersion); err != nil {
			return err
		}
		var spaceID string
		if err := tx.QueryRowContext(ctx, `SELECT space_id FROM space_notes WHERE id=$1`, noteID).Scan(&spaceID); err != nil {
			return err
		}
		if err := recordNoteEventTx(ctx, tx, spaceID, actorUserID, "note.permissions.changed", noteID,
			map[string]any{"acl_version": aclVersion}); err != nil {
			return err
		}
		// A revoked user can no longer be reached through the note event stream,
		// because event visibility is resolved from the grant row that was just
		// deleted. They get a targeted control message instead, which tells the
		// client to drop the note and close its collaboration session without
		// tearing down the Space connection.
		revoked := []string{}
		for userID := range existing {
			if _, kept := desired[userID]; !kept {
				revoked = append(revoked, userID)
			}
		}
		if len(revoked) == 0 {
			return nil
		}
		sort.Strings(revoked)
		return notifySpaceControlTx(ctx, tx, map[string]any{
			"type": "note.access.revoked", "space_id": spaceID, "note_id": noteID,
			"user_ids": revoked, "keep_connection": true,
		})
	})
	return aclVersion, changed, err
}

func sameGrantSet(existing, desired map[string]string) bool {
	if len(existing) != len(desired) {
		return false
	}
	for userID, role := range desired {
		if existing[userID] != role {
			return false
		}
	}
	return true
}

// NoteGrants returns the full permission set. Creator only.
func (db *Database) NoteGrants(ctx context.Context, actorUserID, noteID string) ([]NoteGrant, error) {
	grants := []NoteGrant{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		access, err := noteAccessForTx(ctx, tx, actorUserID, noteID)
		if err != nil {
			return err
		}
		if !access.CanManageACL {
			return ErrSpaceNotFound
		}
		rows, err := tx.QueryContext(ctx,
			`SELECT user_id,role FROM space_note_permissions WHERE note_id=$1 ORDER BY user_id`, noteID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var grant NoteGrant
			if err := rows.Scan(&grant.UserID, &grant.Role); err != nil {
				return err
			}
			grants = append(grants, grant)
		}
		return rows.Err()
	})
	return grants, err
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
			        CASE WHEN n.creator_user_id=$1 THEN 'creator' ELSE p.role END AS effective_role
			 FROM space_notes n
			 LEFT JOIN space_note_permissions p ON p.note_id=n.id AND p.user_id=$1
			 WHERE n.space_id=$2 AND n.lifecycle_state='active'
			   AND (n.creator_user_id=$1 OR p.user_id IS NOT NULL)
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

// DeleteSpaceNote begins hard deletion. It is creator-only and idempotent: a
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
			// Covers viewers, editors, Space owners, and a genuinely missing
			// note with one indistinguishable answer.
			if lifecycle, lookupErr := noteLifecycleTx(ctx, tx, noteID); lookupErr != nil {
				return lookupErr
			} else if lifecycle == NoteLifecycleDeleting {
				// Already deleting: the creator's retry lands here because
				// NoteAccessFor denies non-active notes.
				if creator, creatorErr := noteCreatorTx(ctx, tx, noteID); creatorErr != nil {
					return creatorErr
				} else if creator == userID {
					return nil
				}
			}
			return ErrSpaceNotFound
		}
		var spaceID string
		if err := tx.QueryRowContext(ctx,
			`UPDATE space_notes SET lifecycle_state=$1,acl_version=acl_version+1,updated_at=NOW()
			 WHERE id=$2 AND lifecycle_state=$3 RETURNING space_id`,
			NoteLifecycleDeleting, noteID, NoteLifecycleActive).Scan(&spaceID); err != nil {
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
