package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
)

const MaxLibraryEditVersions = 50

type LibraryCrop struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type LibraryTrim struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

type LibraryMarkupPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type LibraryMarkupElement struct {
	Kind      string               `json:"kind"`
	Points    []LibraryMarkupPoint `json:"points,omitempty"`
	X         float64              `json:"x,omitempty"`
	Y         float64              `json:"y,omitempty"`
	Width     float64              `json:"width,omitempty"`
	Height    float64              `json:"height,omitempty"`
	Color     string               `json:"color"`
	LineWidth float64              `json:"line_width"`
	Opacity   float64              `json:"opacity"`
	Text      string               `json:"text,omitempty"`
}

type LibraryEditDefinition struct {
	Rotation       int                    `json:"rotation"`
	FlipHorizontal bool                   `json:"flip_horizontal"`
	FlipVertical   bool                   `json:"flip_vertical"`
	AutoEnhance    bool                   `json:"auto_enhance"`
	Filter         string                 `json:"filter"`
	Brightness     float64                `json:"brightness"`
	Contrast       float64                `json:"contrast"`
	Saturation     float64                `json:"saturation"`
	Grayscale      float64                `json:"grayscale"`
	Exposure       float64                `json:"exposure"`
	Brilliance     float64                `json:"brilliance"`
	Highlights     float64                `json:"highlights"`
	Shadows        float64                `json:"shadows"`
	BlackPoint     float64                `json:"black_point"`
	Vibrance       float64                `json:"vibrance"`
	Warmth         float64                `json:"warmth"`
	Tint           float64                `json:"tint"`
	Sharpness      float64                `json:"sharpness"`
	Definition     float64                `json:"definition"`
	NoiseReduction float64                `json:"noise_reduction"`
	Vignette       float64                `json:"vignette"`
	Straighten     float64                `json:"straighten"`
	Markup         []LibraryMarkupElement `json:"markup,omitempty"`
	Mute           bool                   `json:"mute"`
	PlaybackSpeed  float64                `json:"playback_speed"`
	Crop           *LibraryCrop           `json:"crop,omitempty"`
	Trim           *LibraryTrim           `json:"trim,omitempty"`
}

type LibraryEditVersion struct {
	ID              string                `json:"id"`
	SpaceLibraryID  string                `json:"space_library_item_id"`
	ParentVersionID string                `json:"parent_version_id,omitempty"`
	CreatedByUserID string                `json:"created_by_user_id"`
	Definition      LibraryEditDefinition `json:"edit_definition"`
	LifecycleState  string                `json:"lifecycle_state"`
	RenditionState  string                `json:"rendition_state"`
	RenditionMIME   string                `json:"rendition_mime_type,omitempty"`
	RenditionBytes  int64                 `json:"rendition_byte_size,omitempty"`
	RenditionError  string                `json:"rendition_error_code,omitempty"`
	VersionNumber   int64                 `json:"version_number"`
	IsCurrent       bool                  `json:"is_current"`
	CreatedAt       time.Time             `json:"created_at"`
	RenditionAt     time.Time             `json:"rendition_updated_at"`
	DeletedAt       *time.Time            `json:"deleted_at,omitempty"`
}

type LibraryEditResult struct {
	Item *SpaceLibraryItem   `json:"item"`
	Edit *LibraryEditVersion `json:"edit,omitempty"`
}

func DefaultLibraryEditDefinition() LibraryEditDefinition {
	return LibraryEditDefinition{Brightness: 1, Contrast: 1, Saturation: 1, PlaybackSpeed: 1}
}

func (definition LibraryEditDefinition) Validate(mimeType string) error {
	if definition.PlaybackSpeed == 0 {
		definition.PlaybackSpeed = 1
	}
	validFilter := definition.Filter == "" || definition.Filter == "vivid" || definition.Filter == "dramatic" || definition.Filter == "warm" || definition.Filter == "cool" || definition.Filter == "mono" || definition.Filter == "noir"
	if !validFilter || definition.Rotation != 0 && definition.Rotation != 90 && definition.Rotation != 180 && definition.Rotation != 270 ||
		!finiteRange(definition.Brightness, 0, 3) || !finiteRange(definition.Contrast, 0, 3) || !finiteRange(definition.Saturation, 0, 3) || !finiteRange(definition.Grayscale, 0, 1) ||
		!finiteRange(definition.Exposure, -2, 2) || !finiteRange(definition.Brilliance, -1, 1) || !finiteRange(definition.Highlights, -1, 1) || !finiteRange(definition.Shadows, -1, 1) ||
		!finiteRange(definition.BlackPoint, -1, 1) || !finiteRange(definition.Vibrance, -1, 1) || !finiteRange(definition.Warmth, -1, 1) || !finiteRange(definition.Tint, -1, 1) ||
		!finiteRange(definition.Sharpness, 0, 2) || !finiteRange(definition.Definition, 0, 2) || !finiteRange(definition.NoiseReduction, 0, 1) || !finiteRange(definition.Vignette, 0, 1) ||
		!finiteRange(definition.Straighten, -45, 45) || !finiteRange(definition.PlaybackSpeed, .5, 2) {
		return ErrLibraryInvalid
	}
	if (definition.Mute || definition.PlaybackSpeed != 1) && !strings.HasPrefix(mimeType, "video/") {
		return ErrLibraryInvalid
	}
	if definition.Crop != nil {
		crop := definition.Crop
		if !finiteRange(crop.X, 0, 1) || !finiteRange(crop.Y, 0, 1) || !finiteRange(crop.Width, 0.01, 1) || !finiteRange(crop.Height, 0.01, 1) || crop.X+crop.Width > 1.000001 || crop.Y+crop.Height > 1.000001 {
			return ErrLibraryInvalid
		}
	}
	if definition.Trim != nil {
		if len(mimeType) < 6 || mimeType[:6] != "video/" || math.IsNaN(definition.Trim.Start) || math.IsNaN(definition.Trim.End) || definition.Trim.Start < 0 || definition.Trim.End <= definition.Trim.Start || definition.Trim.End > 86400 {
			return ErrLibraryInvalid
		}
	}
	if len(definition.Markup) > 16 {
		return ErrLibraryInvalid
	}
	markupCost := 0
	for _, element := range definition.Markup {
		if !validLibraryMarkupElement(element) {
			return ErrLibraryInvalid
		}
		if element.Kind == "cleanup" && !strings.HasPrefix(mimeType, "image/") {
			return ErrLibraryInvalid
		}
		if element.Kind == "text" {
			markupCost += len(element.Text) * 24
		} else if element.Kind == "rectangle" {
			markupCost += 4
		} else {
			markupCost += len(element.Points)
		}
	}
	if markupCost > 1024 {
		return ErrLibraryInvalid
	}
	return nil
}

func validLibraryMarkupElement(element LibraryMarkupElement) bool {
	if !libraryMarkupColor(element.Color) || !finiteRange(element.LineWidth, .001, .1) || !finiteRange(element.Opacity, .05, 1) {
		return false
	}
	switch element.Kind {
	case "stroke", "highlight":
		if len(element.Points) < 2 || len(element.Points) > 64 {
			return false
		}
		for _, point := range element.Points {
			if !finiteRange(point.X, 0, 1) || !finiteRange(point.Y, 0, 1) {
				return false
			}
		}
		return true
	case "rectangle", "cleanup":
		minimum := .001
		if element.Kind == "cleanup" {
			minimum = .01
		}
		return finiteRange(element.X, 0, 1) && finiteRange(element.Y, 0, 1) && finiteRange(element.Width, minimum, 1) && finiteRange(element.Height, minimum, 1) && element.X+element.Width <= 1.000001 && element.Y+element.Height <= 1.000001
	case "text":
		return finiteRange(element.X, 0, 1) && finiteRange(element.Y, 0, 1) && len(element.Text) > 0 && len(element.Text) <= 40 && libraryMarkupText(element.Text)
	default:
		return false
	}
}

func libraryMarkupColor(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, character := range value[1:] {
		if character < '0' || character > '9' && character < 'A' || character > 'F' && character < 'a' || character > 'f' {
			return false
		}
	}
	return true
}

func libraryMarkupText(value string) bool {
	for _, character := range value {
		if character < 32 || character > 126 || strings.ContainsRune("'\\:%[];%", character) {
			return false
		}
	}
	return strings.TrimSpace(value) != ""
}

func finiteRange(value, minimum, maximum float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= minimum && value <= maximum
}

func (db *Database) LibraryEditVersions(ctx context.Context, userID, spaceID, itemID string) ([]LibraryEditVersion, error) {
	versions := []LibraryEditVersion{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		var currentID string
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(current_edit_version_id,'') FROM space_library_items WHERE id=$1 AND space_id=$2`, itemID, spaceID).Scan(&currentID); errors.Is(err, sql.ErrNoRows) {
			return ErrLibraryNotFound
		} else if err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT id,space_library_item_id,COALESCE(parent_version_id,''),created_by_user_id,edit_definition,lifecycle_state,rendition_state,rendition_mime_type,COALESCE(rendition_byte_size,0),rendition_error_code,version_number,created_at,rendition_updated_at,deleted_at FROM library_item_versions WHERE space_library_item_id=$1 AND lifecycle_state='ready' ORDER BY version_number DESC`, itemID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var version LibraryEditVersion
			var raw []byte
			if err := rows.Scan(&version.ID, &version.SpaceLibraryID, &version.ParentVersionID, &version.CreatedByUserID, &raw, &version.LifecycleState, &version.RenditionState, &version.RenditionMIME, &version.RenditionBytes, &version.RenditionError, &version.VersionNumber, &version.CreatedAt, &version.RenditionAt, &version.DeletedAt); err != nil {
				return err
			}
			if err := json.Unmarshal(raw, &version.Definition); err != nil {
				return err
			}
			if version.Definition.PlaybackSpeed == 0 {
				version.Definition.PlaybackSpeed = 1
			}
			version.IsCurrent = version.ID == currentID
			versions = append(versions, version)
		}
		return rows.Err()
	})
	return versions, err
}

func (db *Database) CreateLibraryEditVersion(ctx context.Context, userID, spaceID, itemID string, itemVersion int64, definition LibraryEditDefinition) (*LibraryEditResult, error) {
	if itemVersion < 1 {
		return nil, ErrLibraryInvalid
	}
	edit := &LibraryEditVersion{ID: "edit_" + uuid.NewString(), SpaceLibraryID: itemID, CreatedByUserID: userID, Definition: definition, LifecycleState: "ready", RenditionState: "none"}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		var currentID, mimeType string
		var actualVersion int64
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(i.current_edit_version_id,''),i.version,b.server_detected_mime_type FROM space_library_items i JOIN library_files f ON f.id=i.file_id JOIN library_blobs b ON b.id=f.blob_id WHERE i.id=$1 AND i.space_id=$2 AND i.lifecycle_state='ready' FOR UPDATE OF i`, itemID, spaceID).Scan(&currentID, &actualVersion, &mimeType); errors.Is(err, sql.ErrNoRows) {
			return ErrLibraryNotFound
		} else if err != nil {
			return err
		}
		if actualVersion != itemVersion {
			return ErrLibraryConflict
		}
		if !strings.HasPrefix(mimeType, "image/") && !strings.HasPrefix(mimeType, "video/") {
			return ErrLibraryInvalid
		}
		if err := definition.Validate(mimeType); err != nil {
			return err
		}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM library_item_versions WHERE space_library_item_id=$1 AND lifecycle_state='ready'`, itemID).Scan(&count); err != nil {
			return err
		}
		if count >= MaxLibraryEditVersions {
			return ErrLibraryInvalid
		}
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(max(version_number),0)+1 FROM library_item_versions WHERE space_library_item_id=$1`, itemID).Scan(&edit.VersionNumber); err != nil {
			return err
		}
		edit.ParentVersionID = currentID
		raw, _ := json.Marshal(definition)
		var parent any
		if currentID != "" {
			parent = currentID
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO library_item_versions(id,space_library_item_id,parent_version_id,created_by_user_id,edit_definition,version_number) VALUES($1,$2,$3,$4,$5,$6) RETURNING created_at,rendition_updated_at`, edit.ID, itemID, parent, userID, raw, edit.VersionNumber).Scan(&edit.CreatedAt, &edit.RenditionAt); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_library_items SET current_edit_version_id=$1,version=version+1,updated_at=NOW() WHERE id=$2`, edit.ID, itemID); err != nil {
			return err
		}
		edit.IsCurrent = true
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.edit.created", "edit", edit.ID, "success", map[string]any{"version_number": edit.VersionNumber})
	})
	if err != nil {
		return nil, err
	}
	item, err := db.LibraryItem(ctx, userID, spaceID, itemID)
	if err != nil {
		return nil, err
	}
	return &LibraryEditResult{Item: item, Edit: edit}, nil
}

func (db *Database) SelectLibraryEditVersion(ctx context.Context, userID, spaceID, itemID, editID string, itemVersion int64) (*LibraryEditResult, error) {
	if itemVersion < 1 {
		return nil, ErrLibraryInvalid
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		if editID != "" {
			var valid bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM library_item_versions WHERE id=$1 AND space_library_item_id=$2 AND lifecycle_state='ready')`, editID, itemID).Scan(&valid); err != nil || !valid {
				return ErrLibraryNotFound
			}
		}
		var selected any
		if editID != "" {
			selected = editID
		}
		result, err := tx.ExecContext(ctx, `UPDATE space_library_items SET current_edit_version_id=$1,version=version+1,updated_at=NOW() WHERE id=$2 AND space_id=$3 AND version=$4 AND lifecycle_state='ready'`, selected, itemID, spaceID, itemVersion)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryConflict
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.edit.selected", "edit", editID, "success", map[string]any{"original": editID == ""})
	})
	if err != nil {
		return nil, err
	}
	item, err := db.LibraryItem(ctx, userID, spaceID, itemID)
	if err != nil {
		return nil, err
	}
	return &LibraryEditResult{Item: item}, nil
}

func (db *Database) DeleteLibraryEditVersion(ctx context.Context, userID, spaceID, itemID, editID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		var currentID, renditionState, domainID string
		var editVersionNumber int64
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(current_edit_version_id,'') FROM space_library_items WHERE id=$1 AND space_id=$2 FOR UPDATE`, itemID, spaceID).Scan(&currentID); errors.Is(err, sql.ErrNoRows) {
			return ErrLibraryNotFound
		} else if err != nil {
			return err
		}
		if currentID == editID {
			return ErrLibraryConflict
		}
		if err := tx.QueryRowContext(ctx, `SELECT v.rendition_state,v.version_number,f.security_domain_id FROM library_item_versions v JOIN space_library_items i ON i.id=v.space_library_item_id JOIN library_files f ON f.id=i.file_id WHERE v.id=$1 AND v.space_library_item_id=$2 AND v.lifecycle_state='ready' FOR UPDATE OF v`, editID, itemID).Scan(&renditionState, &editVersionNumber, &domainID); errors.Is(err, sql.ErrNoRows) {
			return ErrLibraryNotFound
		} else if err != nil {
			return err
		}
		var released int64
		if err := tx.QueryRowContext(ctx, `UPDATE space_rendition_reservations SET state='released',updated_at=NOW() WHERE source_kind='edit' AND source_id=$1 AND state='active' RETURNING reserved_bytes`, editID).Scan(&released); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if released > 0 {
			if _, err := tx.ExecContext(ctx, `UPDATE space_storage_usage SET reserved_bytes=GREATEST(0,reserved_bytes-$1),version=version+1,updated_at=NOW() WHERE space_id=$2`, released, spaceID); err != nil {
				return err
			}
		}
		if renditionState == "queued" || renditionState == "processing" {
			if _, err := tx.ExecContext(ctx, `UPDATE library_processing_jobs SET state='canceled',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,error_code='edit_deleted',updated_at=NOW() WHERE job_kind='edit' AND target_id=$1 AND state IN ('queued','leased','running')`, editID); err != nil {
				return err
			}
		}
		result, err := tx.ExecContext(ctx, `UPDATE library_item_versions SET lifecycle_state='recovery',deleted_at=NOW() WHERE id=$1 AND space_library_item_id=$2 AND lifecycle_state='ready'`, editID, itemID)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryNotFound
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_storage_contributions SET state='recovery',updated_at=NOW() WHERE space_id=$1 AND source_kind='edit' AND source_id=$2 AND state='active'`, spaceID, editID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO library_recovery_tombstones(id,security_domain_id,space_id,target_kind,target_id,recover_until,target_version)
			VALUES($1,$2,$3,'edit',$4,NOW()+$5::interval,$6)
			ON CONFLICT(target_kind,target_id) DO UPDATE SET lifecycle_state='recovery',recover_until=EXCLUDED.recover_until,target_version=EXCLUDED.target_version,delete_lease_token=NULL,delete_lease_expires_at=NULL,updated_at=NOW()`, "tombstone_"+uuid.NewString(), domainID, spaceID, editID, LibraryRecoveryWindow.String(), editVersionNumber); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.edit.deleted", "edit", editID, "success", map[string]any{})
	})
}
