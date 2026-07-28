package db

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	DrawingLifecycleActive   = "active"
	DrawingLifecycleDeleting = "deleting"
	DrawingRoleCreator       = "creator"
	DrawingRoleEditor        = "editor"
)

// DrawingAccess is the authoritative capability set for one caller.
type DrawingAccess struct {
	CanView   bool
	CanEdit   bool
	CanDelete bool
	Role      string
}

// SpaceDrawing is server-owned drawing metadata. The Excalidraw scene is
// persisted by the collaboration Durable Object, never duplicated here.
type SpaceDrawing struct {
	ID                    string    `json:"id"`
	SpaceID               string    `json:"space_id"`
	CreatorUserID         string    `json:"creator_user_id"`
	Title                 string    `json:"title"`
	LifecycleState        string    `json:"lifecycle_state"`
	CollaborationRevision int64     `json:"collaboration_revision"`
	ACLVersion            int64     `json:"acl_version"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
	Role                  string    `json:"role"`
	CanDelete             bool      `json:"can_delete"`
}

func normalizeDrawingTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "Untitled drawing"
	}
	if utf8.RuneCountInString(title) > 200 {
		return "", ErrSpaceInvalid
	}
	return title, nil
}

func recordDrawingEventTx(
	ctx context.Context,
	tx *sql.Tx,
	spaceID, actorUserID, eventType, drawingID string,
) error {
	_, err := recordSpaceEventTx(
		ctx,
		tx,
		spaceID,
		actorUserID,
		eventType,
		drawingID,
		map[string]any{"drawing_id": drawingID},
	)
	return err
}

// CreateSpaceDrawing creates a Space-wide collaborative drawing.
func (db *Database) CreateSpaceDrawing(
	ctx context.Context,
	creatorUserID, spaceID, title string,
) (*SpaceDrawing, error) {
	title, err := normalizeDrawingTitle(title)
	if err != nil || creatorUserID == "" || spaceID == "" {
		return nil, ErrSpaceInvalid
	}
	drawing := &SpaceDrawing{
		ID: "drawing_" + uuid.NewString(), SpaceID: spaceID,
		CreatorUserID: creatorUserID, Title: title,
		LifecycleState: DrawingLifecycleActive, ACLVersion: 1,
		Role: DrawingRoleCreator, CanDelete: true,
	}
	err = db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, creatorUserID); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx,
			`INSERT INTO space_drawings(id,space_id,creator_user_id,title)
			 VALUES($1,$2,$3,$4) RETURNING created_at,updated_at`,
			drawing.ID, spaceID, creatorUserID, title,
		).Scan(&drawing.CreatedAt, &drawing.UpdatedAt); err != nil {
			return err
		}
		return recordDrawingEventTx(
			ctx,
			tx,
			spaceID,
			creatorUserID,
			"drawing.created",
			drawing.ID,
		)
	})
	if err != nil {
		return nil, err
	}
	return drawing, nil
}

// AccessibleSpaceDrawings lists active drawings for a current Space member.
func (db *Database) AccessibleSpaceDrawings(
	ctx context.Context,
	userID, spaceID string,
) ([]SpaceDrawing, error) {
	drawings := []SpaceDrawing{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx,
			`SELECT d.id,d.space_id,d.creator_user_id,d.title,d.lifecycle_state,
			        d.collaboration_revision,d.acl_version,d.created_at,d.updated_at,
			        CASE WHEN d.creator_user_id=$1 THEN 'creator' ELSE 'editor' END,
			        (d.creator_user_id=$1 OR s.owner_user_id=$1)
			 FROM space_drawings d
			 JOIN spaces s ON s.id=d.space_id
			 WHERE d.space_id=$2 AND d.lifecycle_state='active'
			 ORDER BY d.updated_at DESC`, userID, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var drawing SpaceDrawing
			if err := rows.Scan(
				&drawing.ID, &drawing.SpaceID, &drawing.CreatorUserID, &drawing.Title,
				&drawing.LifecycleState, &drawing.CollaborationRevision,
				&drawing.ACLVersion, &drawing.CreatedAt, &drawing.UpdatedAt,
				&drawing.Role, &drawing.CanDelete,
			); err != nil {
				return err
			}
			drawings = append(drawings, drawing)
		}
		return rows.Err()
	})
	return drawings, err
}

// DrawingAccessFor resolves capabilities without revealing missing drawings.
func (db *Database) DrawingAccessFor(
	ctx context.Context,
	userID, drawingID string,
) (DrawingAccess, error) {
	var access DrawingAccess
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var err error
		access, err = drawingAccessForTx(ctx, tx, userID, drawingID)
		return err
	})
	return access, err
}

func drawingAccessForTx(
	ctx context.Context,
	tx *sql.Tx,
	userID, drawingID string,
) (DrawingAccess, error) {
	var creatorID, spaceID, lifecycle string
	err := tx.QueryRowContext(ctx,
		`SELECT creator_user_id,space_id,lifecycle_state
		 FROM space_drawings WHERE id=$1`,
		drawingID,
	).Scan(&creatorID, &spaceID, &lifecycle)
	if errors.Is(err, sql.ErrNoRows) {
		return DrawingAccess{}, nil
	}
	if err != nil {
		return DrawingAccess{}, err
	}
	memberRole, err := requireSpaceMemberTx(ctx, tx, spaceID, userID)
	if errors.Is(err, ErrSpaceForbidden) || lifecycle != DrawingLifecycleActive {
		return DrawingAccess{}, nil
	}
	if err != nil {
		return DrawingAccess{}, err
	}
	isCreator := creatorID == userID
	access := DrawingAccess{
		CanView: true, CanEdit: true,
		CanDelete: isCreator || memberRole == "owner",
		Role:      DrawingRoleEditor,
	}
	if isCreator {
		access.Role = DrawingRoleCreator
	}
	return access, nil
}

// SpaceDrawingByID returns a drawing only when the caller can view it.
func (db *Database) SpaceDrawingByID(
	ctx context.Context,
	userID, drawingID string,
) (*SpaceDrawing, error) {
	drawing := &SpaceDrawing{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		access, err := drawingAccessForTx(ctx, tx, userID, drawingID)
		if err != nil {
			return err
		}
		if !access.CanView {
			return ErrSpaceNotFound
		}
		drawing.Role = access.Role
		drawing.CanDelete = access.CanDelete
		return tx.QueryRowContext(ctx,
			`SELECT id,space_id,creator_user_id,title,lifecycle_state,
			        collaboration_revision,acl_version,created_at,updated_at
			 FROM space_drawings WHERE id=$1`, drawingID,
		).Scan(
			&drawing.ID, &drawing.SpaceID, &drawing.CreatorUserID, &drawing.Title,
			&drawing.LifecycleState, &drawing.CollaborationRevision,
			&drawing.ACLVersion, &drawing.CreatedAt, &drawing.UpdatedAt,
		)
	})
	if err != nil {
		return nil, err
	}
	return drawing, nil
}

// RenameSpaceDrawing updates server-owned metadata. Every current member may
// edit drawings, so every editor may rename them.
func (db *Database) RenameSpaceDrawing(
	ctx context.Context,
	userID, drawingID, title string,
) (*SpaceDrawing, error) {
	title, err := normalizeDrawingTitle(title)
	if err != nil {
		return nil, err
	}
	drawing := &SpaceDrawing{}
	err = db.spaceTx(ctx, func(tx *sql.Tx) error {
		access, err := drawingAccessForTx(ctx, tx, userID, drawingID)
		if err != nil {
			return err
		}
		if !access.CanEdit {
			return ErrSpaceNotFound
		}
		drawing.Role = access.Role
		drawing.CanDelete = access.CanDelete
		err = tx.QueryRowContext(ctx,
			`UPDATE space_drawings SET title=$1,updated_at=NOW()
			 WHERE id=$2 AND lifecycle_state='active'
			 RETURNING id,space_id,creator_user_id,title,lifecycle_state,
			           collaboration_revision,acl_version,created_at,updated_at`,
			title, drawingID,
		).Scan(
			&drawing.ID, &drawing.SpaceID, &drawing.CreatorUserID, &drawing.Title,
			&drawing.LifecycleState, &drawing.CollaborationRevision,
			&drawing.ACLVersion, &drawing.CreatedAt, &drawing.UpdatedAt,
		)
		if err != nil {
			return err
		}
		return recordDrawingEventTx(
			ctx,
			tx,
			drawing.SpaceID,
			userID,
			"drawing.updated",
			drawingID,
		)
	})
	if err != nil {
		return nil, err
	}
	return drawing, nil
}

// DeleteSpaceDrawing moves a drawing to deleting and queues Durable Object
// cleanup. The row remains until the purge command is confirmed delivered.
func (db *Database) DeleteSpaceDrawing(
	ctx context.Context,
	userID, drawingID string,
) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		access, err := drawingAccessForTx(ctx, tx, userID, drawingID)
		if err != nil {
			return err
		}
		if !access.CanDelete {
			return ErrSpaceNotFound
		}
		var spaceID string
		err = tx.QueryRowContext(ctx,
			`UPDATE space_drawings
			 SET lifecycle_state='deleting',acl_version=acl_version+1,updated_at=NOW()
			 WHERE id=$1 AND lifecycle_state='active' RETURNING space_id`,
			drawingID,
		).Scan(&spaceID)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceNotFound
		}
		if err != nil {
			return err
		}
		if err := recordDrawingEventTx(
			ctx,
			tx,
			spaceID,
			userID,
			"drawing.deleted",
			drawingID,
		); err != nil {
			return err
		}
		return enqueueDrawingControlTx(
			ctx,
			tx,
			drawingID,
			"purge",
			nil,
		)
	})
}
