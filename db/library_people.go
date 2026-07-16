package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

type LibraryIntelligencePolicy struct {
	SpaceID        string    `json:"space_id"`
	FacesEnabled   bool      `json:"faces_enabled"`
	PetsEnabled    bool      `json:"pets_enabled"`
	OCREnabled     bool      `json:"ocr_enabled"`
	AIEnabled      bool      `json:"ai_enabled"`
	SemanticSearch bool      `json:"semantic_search_enabled"`
	Version        int64     `json:"version"`
	CreatedAt      time.Time `json:"created_at,omitempty"`
	UpdatedAt      time.Time `json:"updated_at,omitempty"`
	QueuedFaceJobs int       `json:"queued_face_jobs"`
	QueuedAIJobs   int       `json:"queued_ai_jobs"`
}

type LibraryPerson struct {
	ID           string    `json:"id"`
	SpaceID      string    `json:"space_id"`
	Kind         string    `json:"kind"`
	Name         string    `json:"name"`
	CoverItemID  string    `json:"cover_item_id,omitempty"`
	ItemCount    int       `json:"item_count"`
	Version      int64     `json:"version"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Lifecycle    string    `json:"lifecycle_state"`
	MergedIntoID string    `json:"merged_into_id,omitempty"`
}

func (db *Database) LibraryPeoplePolicy(ctx context.Context, userID, spaceID string) (*LibraryIntelligencePolicy, error) {
	out := &LibraryIntelligencePolicy{SpaceID: spaceID}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		err := tx.QueryRowContext(ctx, `SELECT faces_enabled,pets_enabled,ocr_enabled,ai_enabled,semantic_search_enabled,version,created_at,updated_at FROM space_library_intelligence_policies WHERE space_id=$1`, spaceID).Scan(&out.FacesEnabled, &out.PetsEnabled, &out.OCREnabled, &out.AIEnabled, &out.SemanticSearch, &out.Version, &out.CreatedAt, &out.UpdatedAt)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `SELECT count(*) FILTER(WHERE job_kind='faces'),count(*) FILTER(WHERE job_kind='ai') FROM library_processing_jobs WHERE space_id=$1 AND job_kind IN ('faces','ai') AND state IN ('queued','leased','running')`, spaceID).Scan(&out.QueuedFaceJobs, &out.QueuedAIJobs)
	})
	return out, err
}

func (db *Database) UpdateLibraryPeoplePolicy(ctx context.Context, userID, spaceID string, version int64, facesEnabled, petsEnabled bool) (*LibraryIntelligencePolicy, error) {
	current, err := db.LibraryPeoplePolicy(ctx, userID, spaceID)
	if err != nil {
		return nil, err
	}
	return db.UpdateLibraryIntelligencePolicy(ctx, userID, spaceID, version, facesEnabled, petsEnabled, current.OCREnabled, current.AIEnabled, current.SemanticSearch)
}

func (db *Database) UpdateLibraryIntelligencePolicy(ctx context.Context, userID, spaceID string, version int64, facesEnabled, petsEnabled, ocrEnabled, aiEnabled, semanticSearch bool) (*LibraryIntelligencePolicy, error) {
	if version < 0 {
		return nil, ErrLibraryInvalid
	}
	aiEnabled = aiEnabled || semanticSearch
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceOwnerTx(ctx, tx, spaceID, userID); err != nil {
			return ErrLibraryForbidden
		}
		var currentVersion int64
		err := tx.QueryRowContext(ctx, `SELECT version FROM space_library_intelligence_policies WHERE space_id=$1 FOR UPDATE`, spaceID).Scan(&currentVersion)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			if version != 0 {
				return ErrLibraryConflict
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO space_library_intelligence_policies(space_id,faces_enabled,pets_enabled,ocr_enabled,ai_enabled,semantic_search_enabled,enabled_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, spaceID, facesEnabled, petsEnabled, ocrEnabled, aiEnabled, semanticSearch, userID); err != nil {
				return err
			}
		case err != nil:
			return err
		case currentVersion != version:
			return ErrLibraryConflict
		default:
			if _, err := tx.ExecContext(ctx, `UPDATE space_library_intelligence_policies SET faces_enabled=$1,pets_enabled=$2,ocr_enabled=$3,ai_enabled=$4,semantic_search_enabled=$5,enabled_by_user_id=$6,version=version+1,updated_at=NOW() WHERE space_id=$7`, facesEnabled, petsEnabled, ocrEnabled, aiEnabled, semanticSearch, userID, spaceID); err != nil {
				return err
			}
		}
		if facesEnabled || petsEnabled {
			rows, err := tx.QueryContext(ctx, `SELECT i.id,s.security_domain_id FROM space_library_items i JOIN library_files f ON f.id=i.file_id JOIN library_blobs b ON b.id=f.blob_id JOIN spaces s ON s.id=i.space_id WHERE i.space_id=$1 AND i.lifecycle_state='ready' AND b.server_detected_mime_type LIKE 'image/%'`, spaceID)
			if err != nil {
				return err
			}
			type faceJobTarget struct{ itemID, domainID string }
			targets := []faceJobTarget{}
			for rows.Next() {
				var itemID, domainID string
				if err := rows.Scan(&itemID, &domainID); err != nil {
					_ = rows.Close()
					return err
				}
				targets = append(targets, faceJobTarget{itemID: itemID, domainID: domainID})
			}
			if err := rows.Close(); err != nil {
				return err
			}
			for _, target := range targets {
				payload, _ := json.Marshal(map[string]bool{"people": facesEnabled, "pets": petsEnabled})
				if _, err := tx.ExecContext(ctx, `INSERT INTO library_processing_jobs(id,security_domain_id,space_id,job_kind,target_kind,target_id,payload,priority) VALUES($1,$2,$3,'faces','space_library_item',$4,$5,5) ON CONFLICT(job_kind,target_kind,target_id) DO UPDATE SET payload=EXCLUDED.payload,state=CASE WHEN library_processing_jobs.state IN ('leased','running') THEN library_processing_jobs.state ELSE 'queued' END,available_at=NOW(),updated_at=NOW()`, "job_"+uuid.NewString(), target.domainID, spaceID, target.itemID, payload); err != nil {
					return err
				}
			}
		} else {
			if _, err := tx.ExecContext(ctx, `UPDATE library_processing_jobs SET state='canceled',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW() WHERE space_id=$1 AND job_kind='faces' AND state IN ('queued','leased','running')`, spaceID); err != nil {
				return err
			}
		}
		if ocrEnabled || aiEnabled || semanticSearch {
			rows, err := tx.QueryContext(ctx, `SELECT i.id,s.security_domain_id FROM space_library_items i JOIN spaces s ON s.id=i.space_id WHERE i.space_id=$1 AND i.lifecycle_state='ready'`, spaceID)
			if err != nil {
				return err
			}
			targets := []struct{ itemID, domainID string }{}
			for rows.Next() {
				var target struct{ itemID, domainID string }
				if err := rows.Scan(&target.itemID, &target.domainID); err != nil {
					_ = rows.Close()
					return err
				}
				targets = append(targets, target)
			}
			if err := rows.Close(); err != nil {
				return err
			}
			payload, _ := json.Marshal(map[string]bool{"ocr": ocrEnabled, "ai": aiEnabled, "semantic": semanticSearch})
			for _, target := range targets {
				if _, err := tx.ExecContext(ctx, `INSERT INTO library_processing_jobs(id,security_domain_id,space_id,job_kind,target_kind,target_id,payload,priority) VALUES($1,$2,$3,'ai','space_library_item',$4,$5,4) ON CONFLICT(job_kind,target_kind,target_id) DO UPDATE SET payload=EXCLUDED.payload,state=CASE WHEN library_processing_jobs.state IN ('leased','running') THEN library_processing_jobs.state ELSE 'queued' END,error_code=NULL,available_at=NOW(),updated_at=NOW()`, "job_"+uuid.NewString(), target.domainID, spaceID, target.itemID, payload); err != nil {
					return err
				}
			}
		} else {
			if _, err := tx.ExecContext(ctx, `UPDATE library_processing_jobs SET state='canceled',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,error_code='policy_disabled',updated_at=NOW() WHERE space_id=$1 AND job_kind='ai' AND state IN ('queued','leased','running')`, spaceID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM space_library_search_documents WHERE space_id=$1`, spaceID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM library_derivatives WHERE space_library_item_id IN (SELECT id FROM space_library_items WHERE space_id=$1) AND kind IN ('ocr','ai_metadata','embedding','search_document')`, spaceID); err != nil {
				return err
			}
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.intelligence.policy.updated", "space", spaceID, "success", map[string]any{"faces_enabled": facesEnabled, "pets_enabled": petsEnabled, "ocr_enabled": ocrEnabled, "ai_enabled": aiEnabled, "semantic_search_enabled": semanticSearch})
	})
	if err != nil {
		return nil, err
	}
	return db.LibraryPeoplePolicy(ctx, userID, spaceID)
}

func (db *Database) LibraryPeople(ctx context.Context, userID, spaceID string) ([]LibraryPerson, error) {
	people := []LibraryPerson{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, libraryPersonSelect+` WHERE p.space_id=$1 AND p.lifecycle_state='active' ORDER BY CASE WHEN p.name='' THEN 1 ELSE 0 END,lower(p.name),p.created_at`, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var person LibraryPerson
			if err := scanLibraryPerson(rows, &person); err != nil {
				return err
			}
			people = append(people, person)
		}
		return rows.Err()
	})
	return people, err
}

func (db *Database) CreateLibraryPerson(ctx context.Context, userID, spaceID, kind, name string, itemIDs []string) (*LibraryPerson, error) {
	kind, name = strings.TrimSpace(strings.ToLower(kind)), strings.TrimSpace(name)
	itemIDs = uniqueSpaceIDs(itemIDs)
	if kind != "person" && kind != "pet" || len([]rune(name)) > 120 || len(itemIDs) > 200 {
		return nil, ErrLibraryInvalid
	}
	personID := "person_" + uuid.NewString()
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		if err := requirePeopleKindEnabledTx(ctx, tx, spaceID, kind); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_people(id,space_id,kind,name,created_by_user_id) VALUES($1,$2,$3,$4,$5)`, personID, spaceID, kind, name, userID); err != nil {
			return err
		}
		if err := addLibraryPersonItemsTx(ctx, tx, userID, spaceID, personID, itemIDs); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.people.created", kind, personID, "success", map[string]any{"item_count": len(itemIDs)})
	})
	if err != nil {
		return nil, err
	}
	return db.LibraryPerson(ctx, userID, spaceID, personID)
}

func (db *Database) LibraryPerson(ctx context.Context, userID, spaceID, personID string) (*LibraryPerson, error) {
	out := &LibraryPerson{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		return scanLibraryPerson(tx.QueryRowContext(ctx, libraryPersonSelect+` WHERE p.id=$1 AND p.space_id=$2`, personID, spaceID), out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLibraryNotFound
	}
	return out, err
}

func (db *Database) UpdateLibraryPerson(ctx context.Context, userID, spaceID, personID string, version int64, name, coverItemID string) (*LibraryPerson, error) {
	name, coverItemID = strings.TrimSpace(name), strings.TrimSpace(coverItemID)
	if version < 1 || len([]rune(name)) > 120 {
		return nil, ErrLibraryInvalid
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		if coverItemID != "" {
			var valid bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_person_observations o JOIN space_people p ON p.id=o.person_id WHERE p.id=$1 AND p.space_id=$2 AND o.space_library_item_id=$3)`, personID, spaceID, coverItemID).Scan(&valid); err != nil || !valid {
				return ErrLibraryInvalid
			}
		}
		var cover any
		if coverItemID != "" {
			cover = coverItemID
		}
		result, err := tx.ExecContext(ctx, `UPDATE space_people SET name=$1,cover_item_id=$2,version=version+1,updated_at=NOW() WHERE id=$3 AND space_id=$4 AND version=$5 AND lifecycle_state='active'`, name, cover, personID, spaceID, version)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryConflict
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.people.updated", "person", personID, "success", map[string]any{})
	})
	if err != nil {
		return nil, err
	}
	return db.LibraryPerson(ctx, userID, spaceID, personID)
}

func (db *Database) AddLibraryPersonItems(ctx context.Context, userID, spaceID, personID string, itemIDs []string) (*LibraryPerson, error) {
	itemIDs = uniqueSpaceIDs(itemIDs)
	if len(itemIDs) < 1 || len(itemIDs) > 200 {
		return nil, ErrLibraryInvalid
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		if err := addLibraryPersonItemsTx(ctx, tx, userID, spaceID, personID, itemIDs); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE space_people SET version=version+1,updated_at=NOW() WHERE id=$1`, personID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return db.LibraryPerson(ctx, userID, spaceID, personID)
}

func (db *Database) RemoveLibraryPersonItems(ctx context.Context, userID, spaceID, personID string, itemIDs []string) (*LibraryPerson, error) {
	itemIDs = uniqueSpaceIDs(itemIDs)
	if len(itemIDs) < 1 || len(itemIDs) > 200 {
		return nil, ErrLibraryInvalid
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `DELETE FROM space_person_observations o USING space_people p WHERE o.person_id=p.id AND p.id=$1 AND p.space_id=$2 AND o.space_library_item_id=ANY($3)`, personID, spaceID, pq.Array(itemIDs))
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryNotFound
		}
		_, err = tx.ExecContext(ctx, `UPDATE space_people SET cover_item_id=CASE WHEN cover_item_id=ANY($2) THEN NULL ELSE cover_item_id END,version=version+1,updated_at=NOW() WHERE id=$1`, personID, pq.Array(itemIDs))
		return err
	})
	if err != nil {
		return nil, err
	}
	return db.LibraryPerson(ctx, userID, spaceID, personID)
}

func (db *Database) LibraryPersonItems(ctx context.Context, userID, spaceID, personID string, limit int) ([]SpaceLibraryItem, error) {
	if limit < 1 || limit > 200 {
		limit = 200
	}
	items := []SpaceLibraryItem{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, libraryItemSelect+` JOIN space_person_observations o ON o.space_library_item_id=i.id JOIN space_people p ON p.id=o.person_id WHERE p.id=$1 AND p.space_id=$2 AND p.lifecycle_state='active' AND i.lifecycle_state='ready' GROUP BY i.id,f.id ORDER BY i.added_at DESC LIMIT $3`, personID, spaceID, limit)
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

func (db *Database) MergeLibraryPeople(ctx context.Context, userID, spaceID, sourceID, targetID string, sourceVersion, targetVersion int64) (*LibraryPerson, error) {
	if sourceID == targetID || sourceVersion < 1 || targetVersion < 1 {
		return nil, ErrLibraryInvalid
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		var sourceKind, targetKind string
		var actualSourceVersion, actualTargetVersion int64
		if err := tx.QueryRowContext(ctx, `SELECT kind,version FROM space_people WHERE id=$1 AND space_id=$2 AND lifecycle_state='active' FOR UPDATE`, sourceID, spaceID).Scan(&sourceKind, &actualSourceVersion); err != nil {
			return ErrLibraryNotFound
		}
		if err := tx.QueryRowContext(ctx, `SELECT kind,version FROM space_people WHERE id=$1 AND space_id=$2 AND lifecycle_state='active' FOR UPDATE`, targetID, spaceID).Scan(&targetKind, &actualTargetVersion); err != nil {
			return ErrLibraryNotFound
		}
		if sourceKind != targetKind || actualSourceVersion != sourceVersion || actualTargetVersion != targetVersion {
			return ErrLibraryConflict
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM space_person_observations source USING space_person_observations target WHERE source.person_id=$1 AND target.person_id=$2 AND source.space_library_item_id=target.space_library_item_id AND source.derivative_id IS NOT DISTINCT FROM target.derivative_id`, sourceID, targetID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_person_observations SET person_id=$1 WHERE person_id=$2`, targetID, sourceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_people SET lifecycle_state='merged',merged_into_id=$1,cover_item_id=NULL,version=version+1,updated_at=NOW() WHERE id=$2`, targetID, sourceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_people SET version=version+1,updated_at=NOW() WHERE id=$1`, targetID); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.people.merged", sourceKind, targetID, "success", map[string]any{"source_id": sourceID})
	})
	if err != nil {
		return nil, err
	}
	return db.LibraryPerson(ctx, userID, spaceID, targetID)
}

func (db *Database) DeleteLibraryPerson(ctx context.Context, userID, spaceID, personID string, version int64) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE space_people SET lifecycle_state='deleted',cover_item_id=NULL,version=version+1,updated_at=NOW() WHERE id=$1 AND space_id=$2 AND version=$3 AND lifecycle_state='active'`, personID, spaceID, version)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryConflict
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM space_person_observations WHERE person_id=$1`, personID); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.people.deleted", "person", personID, "success", map[string]any{})
	})
}

func requirePeopleKindEnabledTx(ctx context.Context, tx *sql.Tx, spaceID, kind string) error {
	var faces, pets bool
	if err := tx.QueryRowContext(ctx, `SELECT faces_enabled,pets_enabled FROM space_library_intelligence_policies WHERE space_id=$1`, spaceID).Scan(&faces, &pets); errors.Is(err, sql.ErrNoRows) {
		return ErrLibraryForbidden
	} else if err != nil {
		return err
	}
	if kind == "person" && !faces || kind == "pet" && !pets {
		return ErrLibraryForbidden
	}
	return nil
}

func addLibraryPersonItemsTx(ctx context.Context, tx *sql.Tx, userID, spaceID, personID string, itemIDs []string) error {
	if len(itemIDs) == 0 {
		return nil
	}
	var kind string
	if err := tx.QueryRowContext(ctx, `SELECT kind FROM space_people WHERE id=$1 AND space_id=$2 AND lifecycle_state='active'`, personID, spaceID).Scan(&kind); errors.Is(err, sql.ErrNoRows) {
		return ErrLibraryNotFound
	} else if err != nil {
		return err
	}
	if err := requirePeopleKindEnabledTx(ctx, tx, spaceID, kind); err != nil {
		return err
	}
	var validCount int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM space_library_items i JOIN library_files f ON f.id=i.file_id JOIN library_blobs b ON b.id=f.blob_id WHERE i.space_id=$1 AND i.id=ANY($2) AND i.lifecycle_state='ready' AND b.server_detected_mime_type LIKE 'image/%'`, spaceID, pq.Array(itemIDs)).Scan(&validCount); err != nil {
		return err
	}
	if validCount != len(itemIDs) {
		return ErrLibraryInvalid
	}
	for _, itemID := range itemIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_person_observations(id,person_id,space_library_item_id,derivative_id,confidence,bounds,source) VALUES($1,$2,$3,NULL,1,'{}','manual') ON CONFLICT DO NOTHING`, "observation_"+uuid.NewString(), personID, itemID); err != nil {
			return err
		}
	}
	return nil
}

const libraryPersonSelect = `SELECT p.id,p.space_id,p.kind,p.name,COALESCE(p.cover_item_id,''),(SELECT count(DISTINCT o.space_library_item_id) FROM space_person_observations o JOIN space_library_items i ON i.id=o.space_library_item_id WHERE o.person_id=p.id AND i.lifecycle_state='ready'),p.version,p.created_at,p.updated_at,p.lifecycle_state,COALESCE(p.merged_into_id,'') FROM space_people p`

func scanLibraryPerson(scanner interface{ Scan(...any) error }, person *LibraryPerson) error {
	return scanner.Scan(&person.ID, &person.SpaceID, &person.Kind, &person.Name, &person.CoverItemID, &person.ItemCount, &person.Version, &person.CreatedAt, &person.UpdatedAt, &person.Lifecycle, &person.MergedIntoID)
}
