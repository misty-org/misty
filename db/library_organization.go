package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	MaxLibraryAlbums     = 500
	MaxLibraryGroups     = 100
	MaxLibraryGroupRules = 12
)

type LibraryAlbum struct {
	ID              string    `json:"id"`
	SpaceID         string    `json:"space_id"`
	FolderID        string    `json:"folder_id,omitempty"`
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	CoverItemID     string    `json:"cover_item_id,omitempty"`
	Position        int64     `json:"position"`
	ViewMode        string    `json:"view_mode"`
	SortMode        string    `json:"sort_mode"`
	CreatedByUserID string    `json:"created_by_user_id"`
	ItemCount       int       `json:"item_count"`
	Version         int64     `json:"version"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type LibraryAlbumFolder struct {
	ID              string    `json:"id"`
	SpaceID         string    `json:"space_id"`
	ParentFolderID  string    `json:"parent_folder_id,omitempty"`
	Name            string    `json:"name"`
	Position        int64     `json:"position"`
	AlbumCount      int       `json:"album_count"`
	FolderCount     int       `json:"folder_count"`
	CreatedByUserID string    `json:"created_by_user_id"`
	Version         int64     `json:"version"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

const libraryAlbumSelect = `SELECT a.id,a.space_id,COALESCE(a.folder_id,''),a.name,a.description,COALESCE(CASE WHEN EXISTS(SELECT 1 FROM space_library_items cover WHERE cover.id=a.cover_item_id AND cover.lifecycle_state='ready' AND cover.hidden=FALSE) THEN a.cover_item_id END,''),a.position,a.view_mode,a.sort_mode,a.created_by_user_id,(SELECT count(*) FROM space_album_items ai JOIN space_library_items i ON i.id=ai.space_library_item_id WHERE ai.album_id=a.id AND i.lifecycle_state='ready' AND i.hidden=FALSE),a.version,a.created_at,a.updated_at FROM space_albums a`

type LibraryGroupRule struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value"`
}

type LibraryGroupRules struct {
	All []LibraryGroupRule `json:"all"`
}

type LibraryGroup struct {
	ID              string            `json:"id"`
	SpaceID         string            `json:"space_id"`
	Name            string            `json:"name"`
	Rules           LibraryGroupRules `json:"rules"`
	CreatedByUserID string            `json:"created_by_user_id"`
	Version         int64             `json:"version"`
	CreatedAt       time.Time         `json:"created_at"`
	UpdatedAt       time.Time         `json:"updated_at"`
}

func (db *Database) LibraryAlbums(ctx context.Context, userID, spaceID string) ([]LibraryAlbum, error) {
	items := []LibraryAlbum{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, libraryAlbumSelect+` WHERE a.space_id=$1 ORDER BY a.position,lower(a.name),a.id`, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item LibraryAlbum
			if err := scanLibraryAlbum(rows, &item); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) CreateLibraryAlbum(ctx context.Context, userID, spaceID, name, description string) (*LibraryAlbum, error) {
	name, description = strings.TrimSpace(name), strings.TrimSpace(description)
	if name == "" || len([]rune(name)) > 120 || len([]rune(description)) > 2000 {
		return nil, ErrLibraryInvalid
	}
	out := &LibraryAlbum{ID: "album_" + uuid.NewString(), SpaceID: spaceID, Name: name, Description: description, CreatedByUserID: userID, Version: 1}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM space_albums WHERE space_id=$1`, spaceID).Scan(&count); err != nil {
			return err
		}
		if count >= MaxLibraryAlbums {
			return ErrLibraryInvalid
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_albums(id,space_id,name,description,created_by_user_id) VALUES($1,$2,$3,$4,$5) RETURNING created_at,updated_at`, out.ID, spaceID, name, description, userID).Scan(&out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.album.created", "album", out.ID, "success", map[string]any{})
	})
	if err != nil {
		return nil, mapLibraryConstraintError(err)
	}
	return db.LibraryAlbum(ctx, userID, spaceID, out.ID)
}

func (db *Database) LibraryAlbum(ctx context.Context, userID, spaceID, albumID string) (*LibraryAlbum, error) {
	out := &LibraryAlbum{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		return scanLibraryAlbum(tx.QueryRowContext(ctx, libraryAlbumSelect+` WHERE a.id=$1 AND a.space_id=$2`, albumID, spaceID), out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLibraryNotFound
	}
	return out, err
}

func (db *Database) UpdateLibraryAlbum(ctx context.Context, userID, spaceID, albumID string, version int64, name, description, coverItemID string) (*LibraryAlbum, error) {
	name, description, coverItemID = strings.TrimSpace(name), strings.TrimSpace(description), strings.TrimSpace(coverItemID)
	if version < 1 || name == "" || len([]rune(name)) > 120 || len([]rune(description)) > 2000 {
		return nil, ErrLibraryInvalid
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		if coverItemID != "" {
			var valid bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_album_items ai JOIN space_albums a ON a.id=ai.album_id JOIN space_library_items i ON i.id=ai.space_library_item_id WHERE a.id=$1 AND a.space_id=$2 AND ai.space_library_item_id=$3 AND i.lifecycle_state='ready' AND i.hidden=FALSE)`, albumID, spaceID, coverItemID).Scan(&valid); err != nil || !valid {
				return ErrLibraryInvalid
			}
		}
		var cover any
		if coverItemID != "" {
			cover = coverItemID
		}
		result, err := tx.ExecContext(ctx, `UPDATE space_albums SET name=$1,description=$2,cover_item_id=$3,version=version+1,updated_at=NOW() WHERE id=$4 AND space_id=$5 AND version=$6`, name, description, cover, albumID, spaceID, version)
		if err != nil {
			return mapLibraryConstraintError(err)
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryConflict
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.album.updated", "album", albumID, "success", map[string]any{"cover_changed": true})
	})
	if err != nil {
		return nil, err
	}
	return db.LibraryAlbum(ctx, userID, spaceID, albumID)
}

func (db *Database) DeleteLibraryAlbum(ctx context.Context, userID, spaceID, albumID string, version int64) error {
	if version < 1 {
		return ErrLibraryInvalid
	}
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `DELETE FROM space_albums WHERE id=$1 AND space_id=$2 AND version=$3`, albumID, spaceID, version)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryConflict
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.album.deleted", "album", albumID, "success", map[string]any{})
	})
}

func (db *Database) OrganizeLibraryAlbum(ctx context.Context, userID, spaceID, albumID string, version int64, folderID, viewMode, sortMode string, position int64) (*LibraryAlbum, error) {
	folderID, viewMode, sortMode = strings.TrimSpace(folderID), strings.TrimSpace(viewMode), strings.TrimSpace(sortMode)
	if version < 1 || position < 0 || viewMode != "grid" && viewMode != "list" || sortMode != "custom" && sortMode != "oldest" && sortMode != "newest" {
		return nil, ErrLibraryInvalid
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		var folder any
		if folderID != "" {
			var valid bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_album_folders WHERE id=$1 AND space_id=$2)`, folderID, spaceID).Scan(&valid); err != nil || !valid {
				return ErrLibraryInvalid
			}
			folder = folderID
		}
		result, err := tx.ExecContext(ctx, `UPDATE space_albums SET folder_id=$1,view_mode=$2,sort_mode=$3,position=$4,version=version+1,updated_at=NOW() WHERE id=$5 AND space_id=$6 AND version=$7`, folder, viewMode, sortMode, position, albumID, spaceID, version)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryConflict
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.album.organized", "album", albumID, "success", map[string]any{"folder_id": folderID, "view_mode": viewMode, "sort_mode": sortMode, "position": position})
	})
	if err != nil {
		return nil, err
	}
	return db.LibraryAlbum(ctx, userID, spaceID, albumID)
}

func (db *Database) LibraryAlbumFolders(ctx context.Context, userID, spaceID string) ([]LibraryAlbumFolder, error) {
	folders := []LibraryAlbumFolder{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT f.id,f.space_id,COALESCE(f.parent_folder_id,''),f.name,f.position,(SELECT count(*) FROM space_albums a WHERE a.folder_id=f.id),(SELECT count(*) FROM space_album_folders child WHERE child.parent_folder_id=f.id),f.created_by_user_id,f.version,f.created_at,f.updated_at FROM space_album_folders f WHERE f.space_id=$1 ORDER BY f.position,lower(f.name),f.id`, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var folder LibraryAlbumFolder
			if err := rows.Scan(&folder.ID, &folder.SpaceID, &folder.ParentFolderID, &folder.Name, &folder.Position, &folder.AlbumCount, &folder.FolderCount, &folder.CreatedByUserID, &folder.Version, &folder.CreatedAt, &folder.UpdatedAt); err != nil {
				return err
			}
			folders = append(folders, folder)
		}
		return rows.Err()
	})
	return folders, err
}

func (db *Database) CreateLibraryAlbumFolder(ctx context.Context, userID, spaceID, parentFolderID, name string) (*LibraryAlbumFolder, error) {
	name, parentFolderID = strings.TrimSpace(name), strings.TrimSpace(parentFolderID)
	if name == "" || len([]rune(name)) > 120 {
		return nil, ErrLibraryInvalid
	}
	folderID := "album_folder_" + uuid.NewString()
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		var parent any
		if parentFolderID != "" {
			var valid bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_album_folders WHERE id=$1 AND space_id=$2)`, parentFolderID, spaceID).Scan(&valid); err != nil || !valid {
				return ErrLibraryInvalid
			}
			parent = parentFolderID
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO space_album_folders(id,space_id,parent_folder_id,name,position,created_by_user_id) VALUES($1,$2,$3,$4,(SELECT COALESCE(max(position),-1)+1 FROM space_album_folders WHERE space_id=$2 AND parent_folder_id IS NOT DISTINCT FROM $3),$5)`, folderID, spaceID, parent, name, userID)
		if err != nil {
			return mapLibraryConstraintError(err)
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.album_folder.created", "album_folder", folderID, "success", map[string]any{"parent_folder_id": parentFolderID})
	})
	if err != nil {
		return nil, err
	}
	folders, err := db.LibraryAlbumFolders(ctx, userID, spaceID)
	for index := range folders {
		if folders[index].ID == folderID {
			return &folders[index], err
		}
	}
	return nil, ErrLibraryNotFound
}

func (db *Database) UpdateLibraryAlbumFolder(ctx context.Context, userID, spaceID, folderID string, version int64, parentFolderID, name string, position int64) (*LibraryAlbumFolder, error) {
	name, parentFolderID = strings.TrimSpace(name), strings.TrimSpace(parentFolderID)
	if version < 1 || position < 0 || name == "" || len([]rune(name)) > 120 || folderID == parentFolderID {
		return nil, ErrLibraryInvalid
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		var parent any
		if parentFolderID != "" {
			var invalid bool
			if err := tx.QueryRowContext(ctx, `WITH RECURSIVE descendants AS (SELECT id FROM space_album_folders WHERE parent_folder_id=$1 UNION ALL SELECT child.id FROM space_album_folders child JOIN descendants d ON child.parent_folder_id=d.id) SELECT NOT EXISTS(SELECT 1 FROM space_album_folders WHERE id=$2 AND space_id=$3) OR EXISTS(SELECT 1 FROM descendants WHERE id=$2)`, folderID, parentFolderID, spaceID).Scan(&invalid); err != nil || invalid {
				return ErrLibraryInvalid
			}
			parent = parentFolderID
		}
		result, err := tx.ExecContext(ctx, `UPDATE space_album_folders SET parent_folder_id=$1,name=$2,position=$3,version=version+1,updated_at=NOW() WHERE id=$4 AND space_id=$5 AND version=$6`, parent, name, position, folderID, spaceID, version)
		if err != nil {
			return mapLibraryConstraintError(err)
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryConflict
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.album_folder.updated", "album_folder", folderID, "success", map[string]any{})
	})
	if err != nil {
		return nil, err
	}
	folders, err := db.LibraryAlbumFolders(ctx, userID, spaceID)
	for index := range folders {
		if folders[index].ID == folderID {
			return &folders[index], err
		}
	}
	return nil, ErrLibraryNotFound
}

func (db *Database) DeleteLibraryAlbumFolder(ctx context.Context, userID, spaceID, folderID string, version int64) error {
	if version < 1 {
		return ErrLibraryInvalid
	}
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `DELETE FROM space_album_folders WHERE id=$1 AND space_id=$2 AND version=$3`, folderID, spaceID, version)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryConflict
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.album_folder.deleted", "album_folder", folderID, "success", map[string]any{})
	})
}

func (db *Database) ReorderLibraryAlbumItems(ctx context.Context, userID, spaceID, albumID string, version int64, itemIDs []string) (*LibraryAlbum, error) {
	if version < 1 || len(itemIDs) < 1 || len(itemIDs) > 1000 || len(uniqueSpaceIDs(itemIDs)) != len(itemIDs) {
		return nil, ErrLibraryInvalid
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		var currentVersion int64
		if err := tx.QueryRowContext(ctx, `SELECT version FROM space_albums WHERE id=$1 AND space_id=$2 FOR UPDATE`, albumID, spaceID).Scan(&currentVersion); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrLibraryNotFound
			}
			return err
		}
		if currentVersion != version {
			return ErrLibraryConflict
		}
		for position, itemID := range itemIDs {
			result, err := tx.ExecContext(ctx, `UPDATE space_album_items ai SET position=$1 WHERE ai.album_id=$2 AND ai.space_library_item_id=$3 AND EXISTS(SELECT 1 FROM space_library_items i WHERE i.id=ai.space_library_item_id AND i.space_id=$4 AND i.lifecycle_state='ready' AND i.hidden=FALSE)`, position, albumID, itemID, spaceID)
			if err != nil {
				return err
			}
			if count, _ := result.RowsAffected(); count == 0 {
				return ErrLibraryInvalid
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_albums SET version=version+1,updated_at=NOW() WHERE id=$1`, albumID); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.album.reordered", "album", albumID, "success", map[string]any{"count": len(itemIDs)})
	})
	if err != nil {
		return nil, err
	}
	return db.LibraryAlbum(ctx, userID, spaceID, albumID)
}

func (db *Database) AddLibraryAlbumItems(ctx context.Context, userID, spaceID, albumID string, itemIDs []string) error {
	itemIDs = uniqueSpaceIDs(itemIDs)
	if len(itemIDs) < 1 || len(itemIDs) > 200 {
		return ErrLibraryInvalid
	}
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_albums WHERE id=$1 AND space_id=$2)`, albumID, spaceID).Scan(&exists); err != nil || !exists {
			return ErrLibraryNotFound
		}
		for _, itemID := range itemIDs {
			result, err := tx.ExecContext(ctx, `INSERT INTO space_album_items(album_id,space_library_item_id,added_by_user_id) SELECT $1,i.id,$3 FROM space_library_items i WHERE i.id=$2 AND i.space_id=$4 AND i.lifecycle_state='ready' AND i.hidden=FALSE ON CONFLICT DO NOTHING`, albumID, itemID, userID, spaceID)
			if err != nil {
				return err
			}
			if count, _ := result.RowsAffected(); count == 0 {
				var valid bool
				if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_library_items WHERE id=$1 AND space_id=$2 AND lifecycle_state='ready' AND hidden=FALSE)`, itemID, spaceID).Scan(&valid); err != nil || !valid {
					return ErrLibraryInvalid
				}
			}
		}
		_, err := tx.ExecContext(ctx, `UPDATE space_albums SET version=version+1,updated_at=NOW() WHERE id=$1`, albumID)
		return err
	})
}

func (db *Database) RemoveLibraryAlbumItem(ctx context.Context, userID, spaceID, albumID, itemID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `DELETE FROM space_album_items ai USING space_albums a WHERE ai.album_id=a.id AND a.id=$1 AND a.space_id=$2 AND ai.space_library_item_id=$3`, albumID, spaceID, itemID)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryNotFound
		}
		_, err = tx.ExecContext(ctx, `UPDATE space_albums SET version=version+1,updated_at=NOW() WHERE id=$1`, albumID)
		return err
	})
}

func (db *Database) LibraryAlbumItems(ctx context.Context, userID, spaceID, albumID string, limit int) ([]SpaceLibraryItem, error) {
	if limit < 1 || limit > 200 {
		limit = 200
	}
	items := []SpaceLibraryItem{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, libraryItemSelect+` JOIN space_album_items ai ON ai.space_library_item_id=i.id JOIN space_albums a ON a.id=ai.album_id WHERE a.id=$1 AND a.space_id=$2 AND i.lifecycle_state='ready' AND i.hidden=FALSE ORDER BY CASE a.sort_mode WHEN 'oldest' THEN extract(epoch FROM COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)) WHEN 'newest' THEN -extract(epoch FROM COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)) ELSE ai.position::double precision END,ai.added_at DESC LIMIT $3`, albumID, spaceID, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceLibraryItem
			if err := scanSpaceLibraryItem(rows, &item); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) LibraryGroups(ctx context.Context, userID, spaceID string) ([]LibraryGroup, error) {
	items := []LibraryGroup{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT id,space_id,name,rules,created_by_user_id,version,created_at,updated_at FROM space_library_groups WHERE space_id=$1 ORDER BY lower(name),id`, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item LibraryGroup
			var raw []byte
			if err := rows.Scan(&item.ID, &item.SpaceID, &item.Name, &raw, &item.CreatedByUserID, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
				return err
			}
			if err := json.Unmarshal(raw, &item.Rules); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) CreateLibraryGroup(ctx context.Context, userID, spaceID, name string, rules LibraryGroupRules) (*LibraryGroup, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 120 || validateLibraryGroupRules(rules) != nil {
		return nil, ErrLibraryInvalid
	}
	raw, _ := json.Marshal(rules)
	out := &LibraryGroup{ID: "group_" + uuid.NewString(), SpaceID: spaceID, Name: name, Rules: rules, CreatedByUserID: userID, Version: 1}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM space_library_groups WHERE space_id=$1`, spaceID).Scan(&count); err != nil {
			return err
		}
		if count >= MaxLibraryGroups {
			return ErrLibraryInvalid
		}
		return tx.QueryRowContext(ctx, `INSERT INTO space_library_groups(id,space_id,name,rules,created_by_user_id) VALUES($1,$2,$3,$4,$5) RETURNING created_at,updated_at`, out.ID, spaceID, name, raw, userID).Scan(&out.CreatedAt, &out.UpdatedAt)
	})
	return out, mapLibraryConstraintError(err)
}

func (db *Database) LibraryGroupItems(ctx context.Context, userID, spaceID, groupID string, limit int) ([]SpaceLibraryItem, error) {
	if limit < 1 || limit > 200 {
		limit = 200
	}
	items := []SpaceLibraryItem{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		var raw []byte
		if err := tx.QueryRowContext(ctx, `SELECT rules FROM space_library_groups WHERE id=$1 AND space_id=$2`, groupID, spaceID).Scan(&raw); errors.Is(err, sql.ErrNoRows) {
			return ErrLibraryNotFound
		} else if err != nil {
			return err
		}
		var rules LibraryGroupRules
		if json.Unmarshal(raw, &rules) != nil || validateLibraryGroupRules(rules) != nil {
			return ErrLibraryInvalid
		}
		conditions := []string{"i.space_id=$1", "i.lifecycle_state='ready'", "i.hidden=FALSE"}
		args := []any{spaceID}
		for _, rule := range rules.All {
			args = append(args, rule.Value)
			placeholder := fmt.Sprintf("$%d", len(args))
			switch rule.Field {
			case "favorite":
				conditions = append(conditions, "i.favorite="+placeholder+"::boolean")
			case "hidden":
				conditions = append(conditions, "i.hidden="+placeholder+"::boolean")
			case "tag":
				conditions = append(conditions, "i.tags ? "+placeholder+"::text")
			case "mime":
				conditions = append(conditions, "f.intrinsic_metadata->>'server_detected_mime_type' LIKE "+placeholder+"::text||'%'")
			case "filename":
				conditions = append(conditions, "i.display_name ILIKE '%'||"+placeholder+"::text||'%'")
			case "album":
				conditions = append(conditions, "EXISTS(SELECT 1 FROM space_album_items ai JOIN space_albums a ON a.id=ai.album_id WHERE ai.space_library_item_id=i.id AND a.id="+placeholder+"::text AND a.space_id=i.space_id)")
			}
		}
		args = append(args, limit)
		query := libraryItemSelect + ` WHERE ` + strings.Join(conditions, " AND ") + fmt.Sprintf(" ORDER BY i.added_at DESC,i.id DESC LIMIT $%d", len(args))
		rows, err := tx.QueryContext(ctx, query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceLibraryItem
			if err := scanSpaceLibraryItem(rows, &item); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func validateLibraryGroupRules(rules LibraryGroupRules) error {
	if len(rules.All) > MaxLibraryGroupRules {
		return ErrLibraryInvalid
	}
	for _, rule := range rules.All {
		switch rule.Field {
		case "favorite", "hidden":
			if rule.Op != "is" {
				return ErrLibraryInvalid
			}
			if _, ok := rule.Value.(bool); !ok {
				return ErrLibraryInvalid
			}
		case "tag", "mime", "filename", "album":
			if rule.Op != "contains" && !(rule.Field == "album" && rule.Op == "in") && !(rule.Field == "mime" && rule.Op == "prefix") {
				return ErrLibraryInvalid
			}
			value, ok := rule.Value.(string)
			if !ok || strings.TrimSpace(value) == "" || len(value) > 255 {
				return ErrLibraryInvalid
			}
		default:
			return ErrLibraryInvalid
		}
	}
	return nil
}

func scanLibraryAlbum(scanner interface{ Scan(...any) error }, out *LibraryAlbum) error {
	return scanner.Scan(&out.ID, &out.SpaceID, &out.FolderID, &out.Name, &out.Description, &out.CoverItemID, &out.Position, &out.ViewMode, &out.SortMode, &out.CreatedByUserID, &out.ItemCount, &out.Version, &out.CreatedAt, &out.UpdatedAt)
}

func mapLibraryConstraintError(err error) error {
	if err != nil && strings.Contains(err.Error(), "duplicate key") {
		return ErrLibraryConflict
	}
	return err
}
