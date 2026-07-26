package db

import (
	"context"
	"database/sql"
	"errors"

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
		_, err := tx.ExecContext(ctx,
			`INSERT INTO space_notes(id,space_id,creator_user_id,title_projection) VALUES($1,$2,$3,$4)`,
			note.ID, spaceID, creatorUserID, title)
		return err
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
		if changed {
			if err := tx.QueryRowContext(ctx,
				`UPDATE space_notes SET acl_version=acl_version+1,updated_at=NOW() WHERE id=$1 RETURNING acl_version`,
				noteID).Scan(&aclVersion); err != nil {
				return err
			}
		}
		return nil
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
