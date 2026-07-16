package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	defaultLibraryRenditionReserve = int64(250_000_000)
	minimumLibraryRenditionReserve = int64(64_000)
)

type LibraryRenditionRequest struct {
	EditID        string `json:"edit_id"`
	State         string `json:"state"`
	ReservedBytes int64  `json:"reserved_bytes"`
}

type LibraryRenditionJob struct {
	ID               string
	SecurityDomainID string
	SpaceID          string
	ItemID           string
	EditID           string
	RequestedBy      string
	SourceObjectKey  string
	SourceMIME       string
	SourceBytes      int64
	SourceSHA256     string
	Definition       LibraryEditDefinition
	ReservedBytes    int64
	LeaseToken       string
	AttemptCount     int
}

type CompleteLibraryRenditionResult struct {
	DiscardObjectKey string
}

type LibraryRenditionPurge struct {
	TombstoneID  string
	EditID       string
	BlobID       string
	ObjectKey    string
	SpaceID      string
	LogicalBytes int64
	LeaseToken   string
}

// QueueLibraryEditRendition atomically reserves Space storage before any
// expensive media processing begins. A zero maximum chooses a conservative
// server estimate and may use the remaining Space allowance as the hard cap.
func (db *Database) QueueLibraryEditRendition(ctx context.Context, userID, spaceID, itemID, editID string, maximumBytes int64) (*LibraryRenditionRequest, error) {
	if editID == "" || maximumBytes < 0 || maximumBytes > MaxSpaceStorageBytes {
		return nil, ErrLibraryInvalid
	}
	out := &LibraryRenditionRequest{EditID: editID}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		var domainID, lifecycle, renditionState string
		var sourceBytes int64
		var renditionBlob sql.NullString
		if err := tx.QueryRowContext(ctx, `SELECT f.security_domain_id,b.byte_size,v.lifecycle_state,v.rendition_state,v.rendition_blob_id
			FROM library_item_versions v JOIN space_library_items i ON i.id=v.space_library_item_id
			JOIN library_files f ON f.id=i.file_id JOIN library_blobs b ON b.id=f.blob_id
			WHERE v.id=$1 AND i.id=$2 AND i.space_id=$3 AND i.lifecycle_state='ready' AND b.lifecycle_state='ready'
			FOR UPDATE OF v,i`, editID, itemID, spaceID).Scan(&domainID, &sourceBytes, &lifecycle, &renditionState, &renditionBlob); errors.Is(err, sql.ErrNoRows) {
			return ErrLibraryNotFound
		} else if err != nil {
			return err
		}
		if lifecycle != "ready" {
			return ErrLibraryConflict
		}
		if renditionState == "ready" && renditionBlob.Valid {
			out.State = "ready"
			return nil
		}
		var activeReserved int64
		err := tx.QueryRowContext(ctx, `SELECT reserved_bytes FROM space_rendition_reservations WHERE source_kind='edit' AND source_id=$1 AND state='active'`, editID).Scan(&activeReserved)
		if err == nil {
			out.State, out.ReservedBytes = renditionState, activeReserved
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_storage_usage(space_id) VALUES($1) ON CONFLICT DO NOTHING`, spaceID); err != nil {
			return err
		}
		var used, reserved int64
		if err := tx.QueryRowContext(ctx, `SELECT used_bytes,reserved_bytes FROM space_storage_usage WHERE space_id=$1 FOR UPDATE`, spaceID).Scan(&used, &reserved); err != nil {
			return err
		}
		remaining := MaxSpaceStorageBytes - used - reserved
		if remaining < minimumLibraryRenditionReserve {
			return ErrLibraryQuota
		}
		requested := maximumBytes
		if requested == 0 {
			requested = sourceBytes
			if requested < 1_000_000 {
				requested = 1_000_000
			}
			if requested > defaultLibraryRenditionReserve {
				requested = defaultLibraryRenditionReserve
			}
			if requested > remaining {
				requested = remaining
			}
		} else if requested > remaining {
			return ErrLibraryQuota
		}
		if requested < minimumLibraryRenditionReserve {
			return ErrLibraryQuota
		}
		reservationID := "rendition_reservation_" + uuid.NewString()
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_rendition_reservations(id,space_id,user_id,source_kind,source_id,reserved_bytes,state,expires_at)
			VALUES($1,$2,$3,'edit',$4,$5,'active',NOW()+INTERVAL '2 hours')
			ON CONFLICT(source_kind,source_id) DO UPDATE SET id=EXCLUDED.id,space_id=EXCLUDED.space_id,user_id=EXCLUDED.user_id,reserved_bytes=EXCLUDED.reserved_bytes,state='active',expires_at=EXCLUDED.expires_at,updated_at=NOW()`, reservationID, spaceID, userID, editID, requested); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_storage_usage SET reserved_bytes=reserved_bytes+$1,version=version+1,updated_at=NOW() WHERE space_id=$2`, requested, spaceID); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]any{"maximum_output_bytes": requested})
		if _, err := tx.ExecContext(ctx, `INSERT INTO library_processing_jobs(id,security_domain_id,space_id,job_kind,target_kind,target_id,payload,priority)
			VALUES($1,$2,$3,'edit','library_item_version',$4,$5,10)
			ON CONFLICT(job_kind,target_kind,target_id) DO UPDATE SET payload=EXCLUDED.payload,state='queued',attempt_count=0,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,available_at=NOW(),error_code=NULL,updated_at=NOW()`, "job_"+uuid.NewString(), domainID, spaceID, editID, payload); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE library_item_versions SET rendition_state='queued',rendition_error_code='',rendition_updated_at=NOW() WHERE id=$1`, editID); err != nil {
			return err
		}
		out.State, out.ReservedBytes = "queued", requested
		return insertLibraryAuditTx(ctx, tx, spaceID, domainID, userID, "library.edit.render_queued", "edit", editID, "success", map[string]any{"reserved_bytes": requested})
	})
	return out, err
}

func (db *Database) ClaimLibraryRenditionJob(ctx context.Context, workerID string, lease time.Duration) (*LibraryRenditionJob, error) {
	if workerID == "" || lease < time.Second || lease > 15*time.Minute {
		return nil, ErrLibraryInvalid
	}
	out := &LibraryRenditionJob{LeaseToken: "lease_" + uuid.NewString()}
	var raw []byte
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `WITH candidate AS (
			SELECT id FROM library_processing_jobs WHERE job_kind='edit' AND (state='queued' AND available_at<=NOW() OR state IN ('leased','running') AND lease_expires_at<=NOW())
			ORDER BY priority DESC,created_at FOR UPDATE SKIP LOCKED LIMIT 1
		), claimed AS (
			UPDATE library_processing_jobs j SET state='leased',lease_token=$1,lease_owner=$2,lease_expires_at=NOW()+$3::interval,attempt_count=attempt_count+1,updated_at=NOW()
			FROM candidate WHERE j.id=candidate.id RETURNING j.*
		)
		SELECT c.id,c.security_domain_id,c.space_id,i.id,v.id,r.user_id,b.r2_object_key,b.server_detected_mime_type,b.byte_size,b.sha256,v.edit_definition,r.reserved_bytes,c.attempt_count
		FROM claimed c JOIN library_item_versions v ON v.id=c.target_id
		JOIN space_library_items i ON i.id=v.space_library_item_id JOIN library_files f ON f.id=i.file_id
		JOIN library_blobs b ON b.id=f.blob_id JOIN space_rendition_reservations r ON r.source_kind='edit' AND r.source_id=v.id AND r.state='active'
		WHERE v.lifecycle_state='ready' AND i.lifecycle_state='ready' AND b.lifecycle_state='ready'`, out.LeaseToken, workerID, lease.String()).
			Scan(&out.ID, &out.SecurityDomainID, &out.SpaceID, &out.ItemID, &out.EditID, &out.RequestedBy, &out.SourceObjectKey, &out.SourceMIME, &out.SourceBytes, &out.SourceSHA256, &raw, &out.ReservedBytes, &out.AttemptCount); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE library_item_versions SET rendition_state='processing',rendition_updated_at=NOW() WHERE id=$1`, out.EditID); err != nil {
			return err
		}
		return json.Unmarshal(raw, &out.Definition)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return out, err
}

func (db *Database) CompleteLibraryRenditionJob(ctx context.Context, job *LibraryRenditionJob, objectKey, mimeType string, byteSize int64, sha string) (*CompleteLibraryRenditionResult, error) {
	if job == nil || job.ID == "" || job.LeaseToken == "" || objectKey == "" || mimeType == "" || byteSize < 1 || byteSize > job.ReservedBytes || len(sha) != 64 {
		return nil, ErrLibraryInvalid
	}
	out := &CompleteLibraryRenditionResult{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `UPDATE library_processing_jobs SET state='running',updated_at=NOW() WHERE id=$1 AND state='leased' AND lease_token=$2 AND lease_expires_at>NOW()`, job.ID, job.LeaseToken)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryConflict
		}
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "library:blob:"+job.SecurityDomainID+":"+sha+fmt.Sprint(byteSize)); err != nil {
			return err
		}
		blobID, existingKey := "", ""
		err = tx.QueryRowContext(ctx, `SELECT id,r2_object_key FROM library_blobs WHERE security_domain_id=$1 AND sha256=$2 AND byte_size=$3 AND lifecycle_state='ready' LIMIT 1`, job.SecurityDomainID, sha, byteSize).Scan(&blobID, &existingKey)
		if errors.Is(err, sql.ErrNoRows) {
			blobID = "blob_" + uuid.NewString()
			if _, err := tx.ExecContext(ctx, `INSERT INTO library_blobs(id,security_domain_id,r2_object_key,sha256,byte_size,client_declared_mime_type,server_detected_mime_type,scan_status,processing_status,lifecycle_state)
				VALUES($1,$2,$3,$4,$5,$6,$6,'clean','ready','ready')`, blobID, job.SecurityDomainID, objectKey, sha, byteSize, mimeType); err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else if existingKey != objectKey {
			out.DiscardObjectKey = objectKey
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_storage_contributions(id,space_id,user_id,file_id,source_kind,source_id,logical_bytes,state)
			VALUES($1,$2,$3,NULL,'edit',$4,$5,'active')`, "contribution_"+uuid.NewString(), job.SpaceID, job.RequestedBy, job.EditID, byteSize); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_rendition_reservations SET state='consumed',updated_at=NOW() WHERE source_kind='edit' AND source_id=$1 AND state='active'`, job.EditID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_storage_usage SET reserved_bytes=GREATEST(0,reserved_bytes-$1),used_bytes=used_bytes+$2,version=version+1,updated_at=NOW() WHERE space_id=$3`, job.ReservedBytes, byteSize, job.SpaceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE library_item_versions SET rendition_blob_id=$1,rendition_state='ready',rendition_mime_type=$2,rendition_byte_size=$3,rendition_error_code='',rendition_updated_at=NOW() WHERE id=$4 AND lifecycle_state='ready'`, blobID, mimeType, byteSize, job.EditID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_library_items SET version=version+1,updated_at=NOW() WHERE id=$1 AND space_id=$2`, job.ItemID, job.SpaceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE library_processing_jobs SET state='completed',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,error_code=NULL,updated_at=NOW() WHERE id=$1`, job.ID); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, job.SpaceID, job.SecurityDomainID, job.RequestedBy, "library.edit.rendered", "edit", job.EditID, "success", map[string]any{"logical_bytes": byteSize, "deduplicated": out.DiscardObjectKey != ""})
	})
	return out, err
}

func (db *Database) FailLibraryRenditionJob(ctx context.Context, job *LibraryRenditionJob, code string) error {
	if job == nil || job.ID == "" || job.LeaseToken == "" || code == "" {
		return ErrLibraryInvalid
	}
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		var attempts, maxAttempts int
		if err := tx.QueryRowContext(ctx, `SELECT attempt_count,max_attempts FROM library_processing_jobs WHERE id=$1 AND lease_token=$2 AND state IN ('leased','running') FOR UPDATE`, job.ID, job.LeaseToken).Scan(&attempts, &maxAttempts); errors.Is(err, sql.ErrNoRows) {
			return ErrLibraryConflict
		} else if err != nil {
			return err
		}
		terminal := attempts >= maxAttempts
		state := "queued"
		if terminal {
			state = "dead"
		}
		if _, err := tx.ExecContext(ctx, `UPDATE library_processing_jobs SET state=$1,error_code=$2,available_at=NOW()+make_interval(secs=>LEAST(300,attempt_count*attempt_count*5)),lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW() WHERE id=$3`, state, code, job.ID); err != nil {
			return err
		}
		if terminal {
			var released int64
			if err := tx.QueryRowContext(ctx, `UPDATE space_rendition_reservations SET state='released',updated_at=NOW() WHERE source_kind='edit' AND source_id=$1 AND state='active' RETURNING reserved_bytes`, job.EditID).Scan(&released); err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if released > 0 {
				if _, err := tx.ExecContext(ctx, `UPDATE space_storage_usage SET reserved_bytes=GREATEST(0,reserved_bytes-$1),version=version+1,updated_at=NOW() WHERE space_id=$2`, released, job.SpaceID); err != nil {
					return err
				}
			}
			if _, err := tx.ExecContext(ctx, `UPDATE library_item_versions SET rendition_state='failed',rendition_error_code=$1,rendition_updated_at=NOW() WHERE id=$2`, code, job.EditID); err != nil {
				return err
			}
			return insertLibraryAuditTx(ctx, tx, job.SpaceID, job.SecurityDomainID, job.RequestedBy, "library.edit.render_failed", "edit", job.EditID, "failed", map[string]any{"code": code})
		}
		_, err := tx.ExecContext(ctx, `UPDATE library_item_versions SET rendition_state='queued',rendition_error_code=$1,rendition_updated_at=NOW() WHERE id=$2`, code, job.EditID)
		return err
	})
}

func (db *Database) ReleaseExpiredLibraryRenditionReservations(ctx context.Context, limit int) (int, error) {
	if limit < 1 || limit > 1000 {
		limit = 100
	}
	releasedCount := 0
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT id,space_id,source_id,reserved_bytes FROM space_rendition_reservations WHERE state='active' AND expires_at<=NOW() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT $1`, limit)
		if err != nil {
			return err
		}
		type expired struct {
			id, spaceID, sourceID string
			bytes                 int64
		}
		var values []expired
		for rows.Next() {
			var value expired
			if err := rows.Scan(&value.id, &value.spaceID, &value.sourceID, &value.bytes); err != nil {
				rows.Close()
				return err
			}
			values = append(values, value)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, value := range values {
			if _, err := tx.ExecContext(ctx, `UPDATE space_rendition_reservations SET state='released',updated_at=NOW() WHERE id=$1`, value.id); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE space_storage_usage SET reserved_bytes=GREATEST(0,reserved_bytes-$1),version=version+1,updated_at=NOW() WHERE space_id=$2`, value.bytes, value.spaceID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE library_item_versions SET rendition_state='failed',rendition_error_code='reservation_expired',rendition_updated_at=NOW() WHERE id=$1 AND rendition_state IN ('queued','processing')`, value.sourceID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE library_processing_jobs SET state='canceled',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,error_code='reservation_expired',updated_at=NOW() WHERE job_kind='edit' AND target_id=$1 AND state IN ('queued','leased','running')`, value.sourceID); err != nil {
				return err
			}
			releasedCount++
		}
		return nil
	})
	return releasedCount, err
}

// ClaimExpiredLibraryRenditionPurge leases one due edit tombstone. ObjectKey
// is empty when the physical blob is still authoritatively referenced and
// only the Space-scoped version/contribution should be removed.
func (db *Database) ClaimExpiredLibraryRenditionPurge(ctx context.Context, lease time.Duration) (*LibraryRenditionPurge, error) {
	if lease < time.Second || lease > 15*time.Minute {
		return nil, ErrLibraryInvalid
	}
	out := &LibraryRenditionPurge{LeaseToken: "delete_lease_" + uuid.NewString()}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var blobID sql.NullString
		if err := tx.QueryRowContext(ctx, `SELECT t.id,t.target_id,COALESCE(t.space_id,''),v.rendition_blob_id,COALESCE(c.logical_bytes,0)
			FROM library_recovery_tombstones t JOIN library_item_versions v ON v.id=t.target_id
			LEFT JOIN space_storage_contributions c ON c.source_kind='edit' AND c.source_id=v.id AND c.state='recovery'
			WHERE t.target_kind='edit' AND t.lifecycle_state='recovery' AND t.recover_until<=NOW()
			AND NOT EXISTS(SELECT 1 FROM library_legal_holds h WHERE h.active AND (h.target_kind='edit' AND h.target_id=t.target_id OR h.target_kind='blob' AND h.target_id=v.rendition_blob_id))
			ORDER BY t.recover_until FOR UPDATE OF t,v SKIP LOCKED LIMIT 1`).Scan(&out.TombstoneID, &out.EditID, &out.SpaceID, &blobID, &out.LogicalBytes); err != nil {
			return err
		}
		if blobID.Valid {
			out.BlobID = blobID.String
			var shared bool
			if err := tx.QueryRowContext(ctx, `SELECT
				EXISTS(SELECT 1 FROM library_files WHERE blob_id=$1 AND lifecycle_state<>'deleted')
				OR EXISTS(SELECT 1 FROM library_item_versions WHERE rendition_blob_id=$1 AND id<>$2 AND lifecycle_state<>'deleted')
				OR EXISTS(SELECT 1 FROM library_derivatives WHERE derivative_blob_id=$1 AND lifecycle_state<>'deleted')
				OR EXISTS(SELECT 1 FROM library_exports WHERE export_blob_id=$1 AND state<>'deleted')
				OR EXISTS(SELECT 1 FROM library_legal_holds WHERE target_kind='blob' AND target_id=$1 AND active)`, out.BlobID, out.EditID).Scan(&shared); err != nil {
				return err
			}
			if !shared {
				if err := tx.QueryRowContext(ctx, `UPDATE library_blobs SET lifecycle_state='purging',version=version+1,updated_at=NOW() WHERE id=$1 AND lifecycle_state='ready' RETURNING r2_object_key`, out.BlobID).Scan(&out.ObjectKey); errors.Is(err, sql.ErrNoRows) {
					return ErrLibraryConflict
				} else if err != nil {
					return err
				}
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE library_item_versions SET lifecycle_state='purging' WHERE id=$1 AND lifecycle_state='recovery'`, out.EditID); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE library_recovery_tombstones SET lifecycle_state='purging',delete_lease_token=$1,delete_lease_expires_at=NOW()+$2::interval,updated_at=NOW() WHERE id=$3 AND lifecycle_state='recovery'`, out.LeaseToken, lease.String(), out.TombstoneID)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryConflict
		}
		return nil
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return out, err
}

func (db *Database) CompleteLibraryRenditionPurge(ctx context.Context, purge *LibraryRenditionPurge) error {
	if purge == nil || purge.TombstoneID == "" || purge.EditID == "" || purge.LeaseToken == "" {
		return ErrLibraryInvalid
	}
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		var valid bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM library_recovery_tombstones WHERE id=$1 AND target_id=$2 AND lifecycle_state='purging' AND delete_lease_token=$3 AND delete_lease_expires_at>NOW())`, purge.TombstoneID, purge.EditID, purge.LeaseToken).Scan(&valid); err != nil || !valid {
			return ErrLibraryConflict
		}
		if purge.ObjectKey != "" {
			result, err := tx.ExecContext(ctx, `UPDATE library_blobs SET lifecycle_state='deleted',deleted_at=NOW(),version=version+1,updated_at=NOW() WHERE id=$1 AND lifecycle_state='purging' AND r2_object_key=$2`, purge.BlobID, purge.ObjectKey)
			if err != nil {
				return err
			}
			if count, _ := result.RowsAffected(); count == 0 {
				return ErrLibraryConflict
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE library_item_versions SET lifecycle_state='deleted' WHERE id=$1 AND lifecycle_state='purging'`, purge.EditID); err != nil {
			return err
		}
		var released int64
		if err := tx.QueryRowContext(ctx, `UPDATE space_storage_contributions SET state='released',released_at=NOW(),updated_at=NOW() WHERE space_id=$1 AND source_kind='edit' AND source_id=$2 AND state='recovery' RETURNING logical_bytes`, purge.SpaceID, purge.EditID).Scan(&released); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if released > 0 {
			if _, err := tx.ExecContext(ctx, `UPDATE space_storage_usage SET used_bytes=GREATEST(0,used_bytes-$1),version=version+1,updated_at=NOW() WHERE space_id=$2`, released, purge.SpaceID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE library_recovery_tombstones SET lifecycle_state='purged',delete_lease_token=NULL,delete_lease_expires_at=NULL,updated_at=NOW() WHERE id=$1`, purge.TombstoneID); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, purge.SpaceID, "", "", "library.edit.purged", "edit", purge.EditID, "success", map[string]any{"released_bytes": released, "physical_blob_deleted": purge.ObjectKey != ""})
	})
}

func (db *Database) FailLibraryRenditionPurge(ctx context.Context, purge *LibraryRenditionPurge) error {
	if purge == nil || purge.TombstoneID == "" || purge.EditID == "" || purge.LeaseToken == "" {
		return ErrLibraryInvalid
	}
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if purge.ObjectKey != "" {
			if _, err := tx.ExecContext(ctx, `UPDATE library_blobs SET lifecycle_state='ready',version=version+1,updated_at=NOW() WHERE id=$1 AND lifecycle_state='purging'`, purge.BlobID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE library_item_versions SET lifecycle_state='recovery' WHERE id=$1 AND lifecycle_state='purging'`, purge.EditID); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE library_recovery_tombstones SET lifecycle_state='recovery',recover_until=NOW()+INTERVAL '1 hour',delete_lease_token=NULL,delete_lease_expires_at=NULL,updated_at=NOW() WHERE id=$1 AND delete_lease_token=$2`, purge.TombstoneID, purge.LeaseToken)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryConflict
		}
		return nil
	})
}
