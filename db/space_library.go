package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

const (
	PermissionLibraryView        = "library.view"
	PermissionMessagesRead       = "messages.read"
	PermissionMessagesWrite      = "messages.write"
	PermissionLibraryUpload      = "library.upload"
	PermissionAttachmentUpload   = "attachments.upload"
	PermissionLibraryAdd         = "library.add"
	PermissionLibraryEdit        = "library.edit"
	PermissionLibraryDownload    = "library.download"
	PermissionLibraryImport      = "library.import"
	PermissionStorageViewMembers = "storage.view_member_usage"
	PermissionStorageManage      = "storage.manage"
	PermissionStorageViewOwn     = "storage.view_own_usage"
	PermissionStudioView         = "studio.view"
	PermissionStudioManage       = "studio.manage"
	PermissionAgentsRun          = "agents.run"
	PermissionTasksView          = "tasks.view"
	PermissionTasksManage        = "tasks.manage"
	PermissionIntegrationsManage = "integrations.manage"
	LibraryRecoveryWindow        = 30 * 24 * time.Hour
)

// Upload purposes decide which Space permission an upload needs and which
// maximum file size applies. The database enforces the maximum independently of
// the API service so a misconfigured service cannot widen the limit.
const (
	UploadPurposeLibrary        = "library"
	UploadPurposeChatAttachment = "attachment"
	UploadPurposeNoteAttachment = "note_attachment"
	UploadPurposeDrawingAsset   = "drawing_attachment"
)

// Default per-purpose maximums. Deployments may lower these through
// configuration, but never above the ceiling enforced here.
const (
	DefaultLibraryMaxFileBytes        = int64(100 << 20)
	DefaultChatAttachmentMaxFileBytes = int64(10 << 20)
	DefaultNoteAttachmentMaxFileBytes = int64(15 << 20)
	DefaultDrawingAssetMaxFileBytes   = int64(15 << 20)
)

// MaxUploadBytesForPurpose is the hard database ceiling for a purpose. An
// unknown purpose has no valid ceiling and returns 0.
func MaxUploadBytesForPurpose(purpose string) int64 {
	switch purpose {
	case UploadPurposeLibrary:
		return DefaultLibraryMaxFileBytes
	case UploadPurposeChatAttachment:
		return DefaultChatAttachmentMaxFileBytes
	case UploadPurposeNoteAttachment:
		return DefaultNoteAttachmentMaxFileBytes
	case UploadPurposeDrawingAsset:
		return DefaultDrawingAssetMaxFileBytes
	default:
		return 0
	}
}

// UploadPurposePermission maps a purpose to the Space permission it requires.
func UploadPurposePermission(purpose string) (string, bool) {
	switch purpose {
	case UploadPurposeLibrary:
		return PermissionLibraryUpload, true
	case UploadPurposeChatAttachment:
		return PermissionAttachmentUpload, true
	case UploadPurposeNoteAttachment:
		// Note assets authorize against the parent note, not a Space-wide
		// permission. Callers must check note edit access before reaching here.
		return PermissionLibraryView, true
	case UploadPurposeDrawingAsset:
		// Drawing assets authorize against the parent drawing.
		return PermissionLibraryView, true
	default:
		return "", false
	}
}

var configurableSpacePermissions = []string{
	PermissionMessagesRead, PermissionMessagesWrite,
	PermissionLibraryView, PermissionLibraryUpload, PermissionAttachmentUpload,
	PermissionLibraryAdd, PermissionLibraryEdit, PermissionLibraryDownload,
	PermissionLibraryImport, PermissionStorageViewOwn, PermissionStorageViewMembers,
	PermissionStorageManage, PermissionStudioView, PermissionStudioManage, PermissionAgentsRun,
	PermissionTasksView, PermissionTasksManage, PermissionIntegrationsManage,
}

var (
	ErrLibraryNotFound         = errors.New("library resource not found")
	ErrLibraryForbidden        = errors.New("library permission denied")
	ErrLibraryInvalid          = errors.New("invalid library request")
	ErrLibraryQuota            = errors.New("space storage quota exceeded")
	ErrLibraryConflict         = errors.New("library resource version conflict")
	ErrLibraryReauthentication = errors.New("library reauthentication required")
	ErrLibraryUploadMismatch   = errors.New("library upload does not match its reservation")
)

type SpaceStorageUsage struct {
	SpaceID            string `json:"space_id"`
	OwnerUserID        string `json:"owner_user_id,omitempty"`
	SpaceUsedBytes     int64  `json:"space_used_bytes"`
	SpaceReservedBytes int64  `json:"space_reserved_bytes"`
	UsedBytes          int64  `json:"used_bytes"`
	ReservedBytes      int64  `json:"reserved_bytes"`
	LimitBytes         int64  `json:"limit_bytes"`
	RemainingBytes     int64  `json:"remaining_bytes"`
	Version            int64  `json:"version"`
}

type LibraryUpload struct {
	ID                     string    `json:"id"`
	SpaceID                string    `json:"space_id"`
	SecurityDomainID       string    `json:"security_domain_id"`
	UserID                 string    `json:"user_id"`
	ObjectKey              string    `json:"-"`
	OriginalFilename       string    `json:"original_filename"`
	Purpose                string    `json:"purpose"`
	ClientDeclaredMIMEType string    `json:"client_declared_mime_type"`
	RequestedByteSize      int64     `json:"requested_byte_size"`
	ClientSHA256           string    `json:"client_sha256"`
	VerifiedByteSize       *int64    `json:"verified_byte_size,omitempty"`
	VerifiedSHA256         string    `json:"verified_sha256,omitempty"`
	DetectedMIMEType       string    `json:"detected_mime_type,omitempty"`
	State                  string    `json:"state"`
	FileID                 string    `json:"file_id,omitempty"`
	UploadTokenHash        string    `json:"-"`
	ErrorCode              string    `json:"error_code,omitempty"`
	ExpiresAt              time.Time `json:"expires_at"`
	Version                int64     `json:"version"`
	CreatedAt              time.Time `json:"created_at"`
	UpdatedAt              time.Time `json:"updated_at"`
}

type LibraryFile struct {
	ID                 string          `json:"id"`
	BlobID             string          `json:"blob_id"`
	SecurityDomainID   string          `json:"security_domain_id"`
	UploaderUserID     string          `json:"uploader_user_id"`
	OriginalFilename   string          `json:"original_filename"`
	IntrinsicMetadata  json.RawMessage `json:"intrinsic_metadata"`
	LifecycleState     string          `json:"lifecycle_state"`
	OriginalUploadedAt time.Time       `json:"original_uploaded_at"`
	Version            int64           `json:"version"`
}

type SpaceLibraryItem struct {
	ID                     string          `json:"id"`
	SpaceID                string          `json:"space_id"`
	FileID                 string          `json:"file_id"`
	ContributingUserID     string          `json:"contributing_user_id"`
	DisplayName            string          `json:"display_name"`
	Caption                string          `json:"caption"`
	Tags                   []string        `json:"tags"`
	Favorite               bool            `json:"favorite"`
	Hidden                 bool            `json:"hidden"`
	DateOverride           *time.Time      `json:"date_override,omitempty"`
	LocationOverride       json.RawMessage `json:"location_override,omitempty"`
	ContributorInformation json.RawMessage `json:"contributor_information"`
	CurrentEditVersionID   string          `json:"current_edit_version_id,omitempty"`
	AddedByUserID          string          `json:"added_by_user_id"`
	LifecycleState         string          `json:"lifecycle_state"`
	AddedAt                time.Time       `json:"added_at"`
	TrashedAt              *time.Time      `json:"trashed_at,omitempty"`
	RecoverUntil           *time.Time      `json:"recover_until,omitempty"`
	Version                int64           `json:"version"`
	UpdatedAt              time.Time       `json:"updated_at"`
	File                   LibraryFile     `json:"file"`
}

type MessageAttachment struct {
	ID             string     `json:"id"`
	SpaceID        string     `json:"space_id"`
	MessageID      string     `json:"message_id,omitempty"`
	FileID         string     `json:"file_id"`
	UploadID       string     `json:"upload_id"`
	UploaderUserID string     `json:"uploader_user_id"`
	DisplayName    string     `json:"display_name"`
	PromotedItemID string     `json:"promoted_item_id,omitempty"`
	LifecycleState string     `json:"lifecycle_state"`
	CreatedAt      time.Time  `json:"created_at"`
	DeletedAt      *time.Time `json:"deleted_at,omitempty"`
	RecoverUntil   *time.Time `json:"recover_until,omitempty"`
}

type CompleteLibraryUploadResult struct {
	Upload           LibraryUpload      `json:"upload"`
	File             LibraryFile        `json:"file"`
	Item             *SpaceLibraryItem  `json:"item,omitempty"`
	Attachment       *MessageAttachment `json:"attachment,omitempty"`
	NoteAsset        *SpaceNoteAsset    `json:"note_asset,omitempty"`
	DrawingAsset     *SpaceDrawingAsset `json:"drawing_asset,omitempty"`
	DiscardObjectKey string             `json:"-"`
}

type LibraryDownload struct {
	ObjectKey string
	Filename  string
	MIMEType  string
	ByteSize  int64
	SHA256    string
	Rendition bool
}

type ExpiredLibraryUpload struct {
	ID        string
	ObjectKey string
}

func (db *Database) HasSpacePermission(ctx context.Context, userID, spaceID, permission string) (bool, error) {
	allowed := false
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var err error
		allowed, err = hasSpacePermissionTx(ctx, tx, userID, spaceID, permission)
		return err
	})
	return allowed, err
}

func (db *Database) SpaceMemberPermissions(ctx context.Context, actorUserID, spaceID, memberUserID string) (map[string]bool, error) {
	out := map[string]bool{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		actorRole, err := requireSpaceMemberTx(ctx, tx, spaceID, actorUserID)
		if err != nil {
			return err
		}
		if actorRole != "owner" && actorUserID != memberUserID {
			return ErrLibraryForbidden
		}
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, memberUserID); err != nil {
			return ErrLibraryNotFound
		}
		for _, permission := range configurableSpacePermissions {
			allowed, err := hasSpacePermissionTx(ctx, tx, memberUserID, spaceID, permission)
			if err != nil {
				return err
			}
			out[permission] = allowed
		}
		applySpacePermissionDependencies(out)
		return nil
	})
	return out, err
}

func applySpacePermissionDependencies(permissions map[string]bool) {
	if !permissions[PermissionMessagesRead] {
		permissions[PermissionMessagesWrite] = false
	}
	if !permissions[PermissionMessagesRead] || !permissions[PermissionMessagesWrite] {
		permissions[PermissionAttachmentUpload] = false
	}
	if !permissions[PermissionTasksView] {
		permissions[PermissionTasksManage] = false
	}
}

func hasSpacePermissionTx(ctx context.Context, tx *sql.Tx, userID, spaceID, permission string) (bool, error) {
	role, err := requireSpaceMemberTx(ctx, tx, spaceID, userID)
	if err != nil {
		return false, ErrLibraryForbidden
	}
	if role == "owner" {
		return true, nil
	}
	return fixedMemberPermission(permission), nil
}

func fixedMemberPermission(permission string) bool {
	switch permission {
	case PermissionMessagesRead, PermissionMessagesWrite, PermissionAttachmentUpload,
		PermissionLibraryView, PermissionLibraryUpload, PermissionLibraryAdd,
		PermissionLibraryEdit, PermissionLibraryDownload, PermissionLibraryImport,
		PermissionStorageViewOwn, PermissionTasksView, PermissionTasksManage:
		return true
	default:
		return false
	}
}

func requireSpacePermissionTx(ctx context.Context, tx *sql.Tx, userID, spaceID, permission string) error {
	allowed, err := hasSpacePermissionTx(ctx, tx, userID, spaceID, permission)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrLibraryForbidden
	}
	return nil
}

func (db *Database) SpaceStorageUsage(ctx context.Context, userID, spaceID string) (*SpaceStorageUsage, error) {
	out := &SpaceStorageUsage{SpaceID: spaceID}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStorageViewOwn); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `SELECT owner_user_id FROM spaces WHERE id=$1`, spaceID).Scan(&out.OwnerUserID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_storage_usage(space_id) VALUES($1) ON CONFLICT DO NOTHING`, spaceID); err != nil {
			return err
		}
		if out.OwnerUserID == userID {
			// Keep the selected Space counter authoritative at read time. Older
			// deployments can leave the derived cache at zero even though its
			// contribution and reservation ledgers contain storage.
			if _, err := tx.ExecContext(ctx, `WITH actual AS (
				SELECT
					COALESCE((SELECT sum(logical_bytes) FROM space_storage_contributions WHERE space_id=$1 AND state IN ('active','recovery')),0) used,
					COALESCE((SELECT sum(reserved_bytes) FROM space_upload_reservations WHERE space_id=$1 AND state='active'),0)
					+ COALESCE((SELECT sum(reserved_bytes) FROM space_rendition_reservations WHERE space_id=$1 AND state='active'),0) reserved
			)
			UPDATE space_storage_usage u
			SET used_bytes=actual.used,reserved_bytes=actual.reserved,version=u.version+1,updated_at=NOW()
			FROM actual
			WHERE u.space_id=$1 AND (u.used_bytes<>actual.used OR u.reserved_bytes<>actual.reserved)`, spaceID); err != nil {
				return err
			}
		}
		if err := tx.QueryRowContext(ctx, `SELECT used_bytes,reserved_bytes,version FROM space_storage_usage WHERE space_id=$1`, spaceID).Scan(&out.SpaceUsedBytes, &out.SpaceReservedBytes, &out.Version); err != nil {
			return err
		}
		owner, err := ownerStorageUsageTx(ctx, tx, out.OwnerUserID, false)
		if err != nil {
			return err
		}
		out.UsedBytes, out.ReservedBytes, out.LimitBytes, out.RemainingBytes = owner.UsedBytes, owner.ReservedBytes, owner.LimitBytes, owner.RemainingBytes
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (db *Database) CreateLibraryUpload(ctx context.Context, userID, spaceID, purpose, filename, declaredMIME string, byteSize int64, clientSHA, objectKey, tokenHash string, expiresAt time.Time) (*LibraryUpload, error) {
	permission, purposeKnown := UploadPurposePermission(purpose)
	maxBytes := MaxUploadBytesForPurpose(purpose)
	if !purposeKnown || byteSize < 1 || byteSize > maxBytes || byteSize > MaxSpaceStorageBytes || len(clientSHA) != 64 || filename == "" || objectKey == "" || tokenHash == "" {
		return nil, ErrLibraryInvalid
	}
	out := &LibraryUpload{ID: "upload_" + uuid.NewString(), SpaceID: spaceID, UserID: userID, ObjectKey: objectKey, OriginalFilename: filename, Purpose: purpose, ClientDeclaredMIMEType: declaredMIME, RequestedByteSize: byteSize, ClientSHA256: clientSHA, State: "initiated", UploadTokenHash: tokenHash, ExpiresAt: expiresAt, Version: 1}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, permission); err != nil {
			return err
		}
		if purpose == "attachment" {
			if err := requireSpaceMessageWriteTx(ctx, tx, userID, spaceID); err != nil {
				return err
			}
		}
		var ownerID string
		if err := tx.QueryRowContext(ctx, `SELECT security_domain_id,owner_user_id FROM spaces WHERE id=$1 FOR SHARE`, spaceID).Scan(&out.SecurityDomainID, &ownerID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "owner-storage:"+ownerID); err != nil {
			return err
		}
		ownerUsage, err := ownerStorageUsageTx(ctx, tx, ownerID, true)
		if err != nil {
			return err
		}
		if ownerUsage.UsedBytes+ownerUsage.ReservedBytes+byteSize > ownerUsage.LimitBytes {
			return ErrLibraryQuota
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_storage_usage(space_id) VALUES($1) ON CONFLICT DO NOTHING`, spaceID); err != nil {
			return err
		}
		var used, reserved int64
		if err := tx.QueryRowContext(ctx, `SELECT used_bytes,reserved_bytes FROM space_storage_usage WHERE space_id=$1 FOR UPDATE`, spaceID).Scan(&used, &reserved); err != nil {
			return err
		}
		_ = used
		_ = reserved
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_library_uploads(id,space_id,security_domain_id,user_id,object_key,original_filename,purpose,client_declared_mime_type,requested_byte_size,client_sha256,state,upload_token_hash,expires_at)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'initiated',$11,$12) RETURNING created_at,updated_at`, out.ID, spaceID, out.SecurityDomainID, userID, objectKey, filename, purpose, declaredMIME, byteSize, clientSHA, tokenHash, expiresAt).Scan(&out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_upload_reservations(upload_id,space_id,user_id,reserved_bytes,state,expires_at) VALUES($1,$2,$3,$4,'active',$5)`, out.ID, spaceID, userID, byteSize, expiresAt); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_storage_usage SET reserved_bytes=reserved_bytes+$1,version=version+1,updated_at=NOW() WHERE space_id=$2`, byteSize, spaceID); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, out.SecurityDomainID, userID, "library.upload.initiated", "upload", out.ID, "success", map[string]any{"purpose": purpose, "reserved_bytes": byteSize})
	})
	return out, err
}

func (db *Database) LibraryUpload(ctx context.Context, userID, spaceID, uploadID string) (*LibraryUpload, error) {
	out := &LibraryUpload{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return ErrLibraryForbidden
		}
		return scanLibraryUpload(tx.QueryRowContext(ctx, `SELECT id,space_id,security_domain_id,user_id,object_key,original_filename,purpose,client_declared_mime_type,requested_byte_size,client_sha256,verified_byte_size,COALESCE(verified_sha256,''),COALESCE(detected_mime_type,''),state,COALESCE(file_id,''),upload_token_hash,COALESCE(error_code,''),expires_at,version,created_at,updated_at FROM space_library_uploads WHERE id=$1 AND space_id=$2 AND user_id=$3`, uploadID, spaceID, userID), out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLibraryNotFound
	}
	return out, err
}

// LibraryUploadDeduplicationObjectKey returns the object currently selected as
// the deduplication target for an upload. The object store must verify this key
// before finalization reuses it; a ready database row alone does not prove the
// immutable object still exists in R2.
func (db *Database) LibraryUploadDeduplicationObjectKey(ctx context.Context, userID, spaceID, uploadID string) (string, error) {
	var objectKey string
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryUpload); err != nil {
			return err
		}
		err := tx.QueryRowContext(ctx, `SELECT b.r2_object_key
			FROM space_library_uploads u
			JOIN library_blobs b ON b.security_domain_id=u.security_domain_id AND b.sha256=u.client_sha256 AND b.byte_size=u.requested_byte_size AND b.lifecycle_state='ready'
			WHERE u.id=$1 AND u.space_id=$2 AND u.user_id=$3 AND u.state='uploaded_unverified' AND b.r2_object_key<>u.object_key
			LIMIT 1`, uploadID, spaceID, userID).Scan(&objectKey)
		if errors.Is(err, sql.ErrNoRows) {
			objectKey = ""
			return nil
		}
		return err
	})
	return objectKey, err
}

// ReplaceMissingLibraryUploadDeduplicationObject heals a deduplicated blob
// whose R2 object disappeared. The caller must first verify that missingKey is
// absent and that the upload's new object exists with the reserved metadata.
func (db *Database) ReplaceMissingLibraryUploadDeduplicationObject(ctx context.Context, userID, spaceID, uploadID, missingKey string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryUpload); err != nil {
			return err
		}
		var domainID, sha, uploadKey, state string
		var byteSize int64
		if err := tx.QueryRowContext(ctx, `SELECT security_domain_id,client_sha256,requested_byte_size,object_key,state
			FROM space_library_uploads WHERE id=$1 AND space_id=$2 AND user_id=$3 FOR UPDATE`, uploadID, spaceID, userID).
			Scan(&domainID, &sha, &byteSize, &uploadKey, &state); err != nil {
			return err
		}
		if state != "uploaded_unverified" || missingKey == "" || uploadKey == missingKey {
			return ErrLibraryConflict
		}
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "library:blob:"+domainID+":"+sha+fmt.Sprint(byteSize)); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE library_blobs
			SET r2_object_key=$1,version=version+1,updated_at=NOW()
			WHERE security_domain_id=$2 AND sha256=$3 AND byte_size=$4 AND lifecycle_state='ready' AND r2_object_key=$5`,
			uploadKey, domainID, sha, byteSize, missingKey)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 1 {
			return nil
		}
		var currentKey string
		if err := tx.QueryRowContext(ctx, `SELECT r2_object_key FROM library_blobs WHERE security_domain_id=$1 AND sha256=$2 AND byte_size=$3 AND lifecycle_state='ready' LIMIT 1`, domainID, sha, byteSize).Scan(&currentKey); err != nil {
			return err
		}
		if currentKey == uploadKey {
			return nil
		}
		return ErrLibraryConflict
	})
}

func (db *Database) SetLibraryUploadState(ctx context.Context, userID, spaceID, uploadID, tokenHash, from, to string) (*LibraryUpload, error) {
	out := &LibraryUpload{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		return scanLibraryUpload(tx.QueryRowContext(ctx, `UPDATE space_library_uploads SET state=$1,version=version+1,updated_at=NOW()
			WHERE id=$2 AND space_id=$3 AND user_id=$4 AND upload_token_hash=$5 AND state=$6 AND expires_at>NOW()
			RETURNING id,space_id,security_domain_id,user_id,object_key,original_filename,purpose,client_declared_mime_type,requested_byte_size,client_sha256,verified_byte_size,COALESCE(verified_sha256,''),COALESCE(detected_mime_type,''),state,COALESCE(file_id,''),upload_token_hash,COALESCE(error_code,''),expires_at,version,created_at,updated_at`, to, uploadID, spaceID, userID, tokenHash, from), out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLibraryConflict
	}
	return out, err
}

func (db *Database) RejectLibraryUpload(ctx context.Context, userID, spaceID, uploadID, tokenHash, state, errorCode string) error {
	if state != "rejected" && state != "infected" && state != "invalid" && state != "processing_failed" && state != "expired" {
		return ErrLibraryInvalid
	}
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		var upload LibraryUpload
		if err := scanLibraryUpload(tx.QueryRowContext(ctx, `SELECT id,space_id,security_domain_id,user_id,object_key,original_filename,purpose,client_declared_mime_type,requested_byte_size,client_sha256,verified_byte_size,COALESCE(verified_sha256,''),COALESCE(detected_mime_type,''),state,COALESCE(file_id,''),upload_token_hash,COALESCE(error_code,''),expires_at,version,created_at,updated_at FROM space_library_uploads WHERE id=$1 AND space_id=$2 AND user_id=$3 FOR UPDATE`, uploadID, spaceID, userID), &upload); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrLibraryNotFound
			}
			return err
		}
		if upload.UploadTokenHash != tokenHash {
			return ErrLibraryForbidden
		}
		if upload.State == "ready" {
			return ErrLibraryConflict
		}
		var released int64
		if err := tx.QueryRowContext(ctx, `UPDATE space_upload_reservations SET state='released',updated_at=NOW() WHERE upload_id=$1 AND state='active' RETURNING reserved_bytes`, upload.ID).Scan(&released); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if released > 0 {
			if _, err := tx.ExecContext(ctx, `UPDATE space_storage_usage SET reserved_bytes=GREATEST(0,reserved_bytes-$1),version=version+1,updated_at=NOW() WHERE space_id=$2`, released, spaceID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_library_uploads SET state=$1,error_code=$2,version=version+1,updated_at=NOW() WHERE id=$3`, state, errorCode, upload.ID); err != nil {
			return err
		}
		if _, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "library.upload."+state, upload.ID, map[string]any{"upload_id": upload.ID, "state": state, "error_code": errorCode}); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, upload.SecurityDomainID, userID, "library.upload."+state, "upload", upload.ID, "failed", map[string]any{"error_code": errorCode, "released_bytes": released})
	})
}

func (db *Database) ExpireLibraryUploads(ctx context.Context, limit int) ([]ExpiredLibraryUpload, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	out := []ExpiredLibraryUpload{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT u.id,u.object_key,u.space_id,u.security_domain_id,u.user_id,r.reserved_bytes
			FROM space_library_uploads u JOIN space_upload_reservations r ON r.upload_id=u.id
			WHERE r.state='active' AND u.expires_at<=NOW() AND u.state NOT IN ('ready','deleted','expired')
			ORDER BY u.expires_at FOR UPDATE OF u,r SKIP LOCKED LIMIT $1`, limit)
		if err != nil {
			return err
		}
		type candidate struct {
			id, key, spaceID, domainID, userID string
			reserved                           int64
		}
		candidates := []candidate{}
		for rows.Next() {
			var item candidate
			if err := rows.Scan(&item.id, &item.key, &item.spaceID, &item.domainID, &item.userID, &item.reserved); err != nil {
				rows.Close()
				return err
			}
			candidates = append(candidates, item)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, item := range candidates {
			if _, err := tx.ExecContext(ctx, `UPDATE space_upload_reservations SET state='released',updated_at=NOW() WHERE upload_id=$1 AND state='active'`, item.id); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE space_storage_usage SET reserved_bytes=GREATEST(0,reserved_bytes-$1),version=version+1,updated_at=NOW() WHERE space_id=$2`, item.reserved, item.spaceID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE space_library_uploads SET state='expired',error_code='upload_expired',version=version+1,updated_at=NOW() WHERE id=$1`, item.id); err != nil {
				return err
			}
			if err := insertLibraryAuditTx(ctx, tx, item.spaceID, item.domainID, item.userID, "library.upload.expired", "upload", item.id, "failed", map[string]any{"released_bytes": item.reserved}); err != nil {
				return err
			}
			out = append(out, ExpiredLibraryUpload{ID: item.id, ObjectKey: item.key})
		}
		return nil
	})
	return out, err
}

func (db *Database) ReconcileLibraryStorageUsage(ctx context.Context, limit int) (int, error) {
	if limit < 1 || limit > 1000 {
		limit = 250
	}
	updated := 0
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `WITH candidates AS (
			SELECT space_id FROM space_storage_usage ORDER BY updated_at LIMIT $1 FOR UPDATE SKIP LOCKED
		), actual AS (
			SELECT c.space_id,
				COALESCE((SELECT sum(logical_bytes) FROM space_storage_contributions sc WHERE sc.space_id=c.space_id AND sc.state IN ('active','recovery')),0) used,
				COALESCE((SELECT sum(reserved_bytes) FROM space_upload_reservations sr WHERE sr.space_id=c.space_id AND sr.state='active'),0)
				+ COALESCE((SELECT sum(reserved_bytes) FROM space_rendition_reservations rr WHERE rr.space_id=c.space_id AND rr.state='active'),0) reserved
			FROM candidates c
		)
		UPDATE space_storage_usage u SET used_bytes=a.used,reserved_bytes=a.reserved,version=u.version+1,updated_at=NOW()
		FROM actual a WHERE u.space_id=a.space_id AND (u.used_bytes<>a.used OR u.reserved_bytes<>a.reserved)`, limit)
		if err != nil {
			return err
		}
		count, _ := result.RowsAffected()
		updated = int(count)
		return nil
	})
	return updated, err
}

func (db *Database) TrashLibraryItem(ctx context.Context, userID, spaceID, itemID string) (*SpaceLibraryItem, error) {
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE space_library_items SET lifecycle_state='trash',trashed_at=NOW(),recover_until=NOW()+$1::interval,version=version+1,updated_at=NOW() WHERE id=$2 AND space_id=$3 AND lifecycle_state='ready'`, "30 days", itemID, spaceID)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryNotFound
		}
		if _, err = tx.ExecContext(ctx, `UPDATE space_storage_contributions SET state='recovery',updated_at=NOW() WHERE space_id=$1 AND source_kind='library_item' AND source_id=$2 AND state='active'`, spaceID, itemID); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.item.trashed", "library_item", itemID, "success", map[string]any{})
	})
	if err != nil {
		return nil, err
	}
	return db.LibraryItem(ctx, userID, spaceID, itemID)
}

func (db *Database) RestoreLibraryItem(ctx context.Context, userID, spaceID, itemID string) (*SpaceLibraryItem, error) {
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE space_library_items SET lifecycle_state='ready',trashed_at=NULL,recover_until=NULL,version=version+1,updated_at=NOW() WHERE id=$1 AND space_id=$2 AND lifecycle_state='trash' AND recover_until>NOW()`, itemID, spaceID)
		if err != nil {
			return err
		}
		if count, _ := result.RowsAffected(); count == 0 {
			return ErrLibraryNotFound
		}
		if _, err = tx.ExecContext(ctx, `UPDATE space_storage_contributions SET state='active',updated_at=NOW() WHERE space_id=$1 AND source_kind='library_item' AND source_id=$2 AND state='recovery'`, spaceID, itemID); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.item.restored", "library_item", itemID, "success", map[string]any{})
	})
	if err != nil {
		return nil, err
	}
	return db.LibraryItem(ctx, userID, spaceID, itemID)
}

func (db *Database) CompleteLibraryUpload(ctx context.Context, userID, spaceID, uploadID, tokenHash string, verifiedSize int64, verifiedSHA, detectedMIME string, intrinsic json.RawMessage) (*CompleteLibraryUploadResult, error) {
	result := &CompleteLibraryUploadResult{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		upload := &result.Upload
		if err := scanLibraryUpload(tx.QueryRowContext(ctx, `SELECT id,space_id,security_domain_id,user_id,object_key,original_filename,purpose,client_declared_mime_type,requested_byte_size,client_sha256,verified_byte_size,COALESCE(verified_sha256,''),COALESCE(detected_mime_type,''),state,COALESCE(file_id,''),upload_token_hash,COALESCE(error_code,''),expires_at,version,created_at,updated_at FROM space_library_uploads WHERE id=$1 AND space_id=$2 AND user_id=$3 FOR UPDATE`, uploadID, spaceID, userID), upload); err != nil {
			return err
		}
		if upload.UploadTokenHash != tokenHash || upload.ExpiresAt.Before(time.Now()) {
			return ErrLibraryForbidden
		}
		if upload.State == "ready" {
			return loadCompletedLibraryUploadTx(ctx, tx, upload, result)
		}
		if upload.State != "uploaded_unverified" && upload.State != "quarantined" && upload.State != "scanning" && upload.State != "processing" {
			return ErrLibraryConflict
		}
		if verifiedSize != upload.RequestedByteSize || verifiedSHA != upload.ClientSHA256 || verifiedSize < 1 || detectedMIME == "" {
			return ErrLibraryUploadMismatch
		}
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "library:blob:"+upload.SecurityDomainID+":"+verifiedSHA+fmt.Sprint(verifiedSize)); err != nil {
			return err
		}
		blobID, objectKey := "", upload.ObjectKey
		err := tx.QueryRowContext(ctx, `SELECT id,r2_object_key FROM library_blobs WHERE security_domain_id=$1 AND sha256=$2 AND byte_size=$3 AND lifecycle_state='ready' LIMIT 1`, upload.SecurityDomainID, verifiedSHA, verifiedSize).Scan(&blobID, &objectKey)
		if errors.Is(err, sql.ErrNoRows) {
			blobID = "blob_" + uuid.NewString()
			if _, err = tx.ExecContext(ctx, `INSERT INTO library_blobs(id,security_domain_id,r2_object_key,sha256,byte_size,client_declared_mime_type,server_detected_mime_type,scan_status,processing_status,lifecycle_state) VALUES($1,$2,$3,$4,$5,$6,$7,'clean','ready','ready')`, blobID, upload.SecurityDomainID, upload.ObjectKey, verifiedSHA, verifiedSize, upload.ClientDeclaredMIMEType, detectedMIME); err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else if objectKey != upload.ObjectKey {
			result.DiscardObjectKey = upload.ObjectKey
		}
		file := &result.File
		file.ID, file.BlobID, file.SecurityDomainID, file.UploaderUserID, file.OriginalFilename, file.IntrinsicMetadata, file.LifecycleState, file.Version = "file_"+uuid.NewString(), blobID, upload.SecurityDomainID, userID, upload.OriginalFilename, intrinsic, "ready", 1
		if len(file.IntrinsicMetadata) == 0 {
			file.IntrinsicMetadata = json.RawMessage(`{}`)
		}
		var extracted struct {
			CaptureTimestamp string          `json:"capture_timestamp"`
			EmbeddedLocation json.RawMessage `json:"embedded_location"`
		}
		_ = json.Unmarshal(file.IntrinsicMetadata, &extracted)
		var captureAt, intrinsicLocation any
		if parsed, parseErr := time.Parse(time.RFC3339Nano, extracted.CaptureTimestamp); parseErr == nil {
			captureAt = parsed
		}
		if len(extracted.EmbeddedLocation) > 2 && json.Valid(extracted.EmbeddedLocation) {
			intrinsicLocation = extracted.EmbeddedLocation
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO library_files(id,blob_id,security_domain_id,uploader_user_id,original_filename,intrinsic_metadata,intrinsic_capture_at,intrinsic_location,lifecycle_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ready') RETURNING original_uploaded_at`, file.ID, blobID, upload.SecurityDomainID, userID, upload.OriginalFilename, file.IntrinsicMetadata, captureAt, intrinsicLocation).Scan(&file.OriginalUploadedAt); err != nil {
			return err
		}
		sourceID, sourceKind := "", ""
		if upload.Purpose == "library" {
			item := &SpaceLibraryItem{ID: "item_" + uuid.NewString(), SpaceID: spaceID, FileID: file.ID, ContributingUserID: userID, DisplayName: upload.OriginalFilename, AddedByUserID: userID, LifecycleState: "ready", Version: 1, File: *file}
			item.Tags, item.LocationOverride, item.ContributorInformation = []string{}, json.RawMessage(`null`), json.RawMessage(`{}`)
			if err := tx.QueryRowContext(ctx, `INSERT INTO space_library_items(id,space_id,file_id,contributing_user_id,display_name,added_by_user_id) VALUES($1,$2,$3,$4,$5,$4) RETURNING added_at,updated_at`, item.ID, spaceID, file.ID, userID, upload.OriginalFilename).Scan(&item.AddedAt, &item.UpdatedAt); err != nil {
				return err
			}
			if err := insertDefaultAliasTx(ctx, tx, spaceID, "library_item", item.ID, userID); err != nil {
				return err
			}
			result.Item, sourceID, sourceKind = item, item.ID, "library_item"
		} else if upload.Purpose == UploadPurposeNoteAttachment {
			// A note asset is deliberately not a Library item and not a message
			// attachment: it is reachable only through its parent note's ACL.
			var noteID string
			if err := tx.QueryRowContext(ctx, `SELECT COALESCE(note_id,'') FROM space_library_uploads WHERE id=$1`, upload.ID).Scan(&noteID); err != nil {
				return err
			}
			if noteID == "" {
				return ErrLibraryInvalid
			}
			asset := &SpaceNoteAsset{ID: "noteasset_" + uuid.NewString(), NoteID: noteID, FileID: file.ID, UploaderUserID: userID, DisplayName: upload.OriginalFilename, LifecycleState: "ready"}
			if err := tx.QueryRowContext(ctx, `INSERT INTO space_note_assets(id,note_id,file_id,uploader_user_id,display_name) VALUES($1,$2,$3,$4,$5) RETURNING created_at`, asset.ID, noteID, file.ID, userID, upload.OriginalFilename).Scan(&asset.CreatedAt); err != nil {
				return err
			}
			result.NoteAsset, sourceID, sourceKind = asset, asset.ID, "note_asset"
		} else if upload.Purpose == UploadPurposeDrawingAsset {
			// Excalidraw keeps only this stable asset identity in the shared
			// Yjs document. Image bytes stay in R2.
			var drawingID, excalidrawFileID string
			if err := tx.QueryRowContext(
				ctx,
				`SELECT COALESCE(drawing_id,''),COALESCE(drawing_file_id,'')
				 FROM space_library_uploads WHERE id=$1`,
				upload.ID,
			).Scan(&drawingID, &excalidrawFileID); err != nil {
				return err
			}
			if drawingID == "" || excalidrawFileID == "" {
				return ErrLibraryInvalid
			}
			asset := &SpaceDrawingAsset{
				ID: "drawingasset_" + uuid.NewString(), DrawingID: drawingID,
				FileID: file.ID, UploaderUserID: userID,
				ExcalidrawFileID: excalidrawFileID,
				DisplayName:      upload.OriginalFilename,
				LifecycleState:   "ready",
				MIMEType:         detectedMIME,
				ByteSize:         verifiedSize,
				SHA256:           verifiedSHA,
			}
			if err := tx.QueryRowContext(
				ctx,
				`INSERT INTO space_drawing_assets(
				     id,drawing_id,file_id,uploader_user_id,
				     excalidraw_file_id,display_name
				 ) VALUES($1,$2,$3,$4,$5,$6)
				 RETURNING created_at`,
				asset.ID, drawingID, file.ID, userID,
				excalidrawFileID, upload.OriginalFilename,
			).Scan(&asset.CreatedAt); err != nil {
				return err
			}
			result.DrawingAsset, sourceID, sourceKind =
				asset, asset.ID, "drawing_asset"
		} else {
			attachment := &MessageAttachment{ID: "attachment_" + uuid.NewString(), SpaceID: spaceID, FileID: file.ID, UploadID: upload.ID, UploaderUserID: userID, DisplayName: upload.OriginalFilename, LifecycleState: "ready"}
			if err := tx.QueryRowContext(ctx, `INSERT INTO space_message_attachments(id,space_id,file_id,upload_id,uploader_user_id,display_name) VALUES($1,$2,$3,$4,$5,$6) RETURNING created_at`, attachment.ID, spaceID, file.ID, upload.ID, userID, upload.OriginalFilename).Scan(&attachment.CreatedAt); err != nil {
				return err
			}
			if err := insertDefaultAliasTx(ctx, tx, spaceID, "attachment", attachment.ID, userID); err != nil {
				return err
			}
			result.Attachment, sourceID, sourceKind = attachment, attachment.ID, "attachment"
		}
		contributionID := "contribution_" + uuid.NewString()
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_storage_contributions(id,space_id,user_id,file_id,source_kind,source_id,logical_bytes,state) VALUES($1,$2,$3,$4,$5,$6,$7,'active')`, contributionID, spaceID, userID, file.ID, sourceKind, sourceID, verifiedSize); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_upload_reservations SET state='consumed',updated_at=NOW() WHERE upload_id=$1 AND state='active'`, upload.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_storage_usage SET reserved_bytes=GREATEST(0,reserved_bytes-$1),used_bytes=used_bytes+$2,version=version+1,updated_at=NOW() WHERE space_id=$3`, upload.RequestedByteSize, verifiedSize, spaceID); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `UPDATE space_library_uploads SET verified_byte_size=$1,verified_sha256=$2,detected_mime_type=$3,state='ready',file_id=$4,finalized_at=NOW(),version=version+1,updated_at=NOW() WHERE id=$5 RETURNING version,updated_at`, verifiedSize, verifiedSHA, detectedMIME, file.ID, upload.ID).Scan(&upload.Version, &upload.UpdatedAt); err != nil {
			return err
		}
		upload.VerifiedByteSize, upload.VerifiedSHA256, upload.DetectedMIMEType, upload.State, upload.FileID = &verifiedSize, verifiedSHA, detectedMIME, "ready", file.ID
		if _, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "library.upload.ready", upload.ID, map[string]any{"upload_id": upload.ID, "state": "ready", "item_id": sourceID, "purpose": upload.Purpose}); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, upload.SecurityDomainID, userID, "library.upload.ready", sourceKind, sourceID, "success", map[string]any{"logical_bytes": verifiedSize, "deduplicated": result.DiscardObjectKey != ""})
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLibraryNotFound
	}
	return result, err
}

type LibraryItemQuery struct {
	After      string
	Limit      int
	Collection string
	Search     string
	Sort       string
	Direction  string
	MediaType  string
	Utility    string
	Visibility string
	AlbumID    string
	Favorite   bool
	DateFrom   *time.Time
	DateTo     *time.Time
}

type LibraryItemVersion struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
}

type BulkLibraryItemOperation struct {
	Action           string
	Items            []LibraryItemVersion
	AlbumID          string
	Tags             []string
	DateOverride     *time.Time
	LocationOverride json.RawMessage
}

type parsedLibrarySearch struct {
	Text      string
	Tags      []string
	MediaType string
	Album     string
	Favorite  *bool
	Hidden    *bool
	DateFrom  *time.Time
	DateTo    *time.Time
}

func (db *Database) LibraryItems(ctx context.Context, userID, spaceID string, query LibraryItemQuery) ([]SpaceLibraryItem, error) {
	if query.Limit < 1 || query.Limit > 200 {
		query.Limit = 100
	}
	query.Search = strings.TrimSpace(query.Search)
	if len([]rune(query.Search)) > 240 {
		return nil, ErrLibraryInvalid
	}
	structuredSearch, err := parseLibrarySearch(query.Search)
	if err != nil {
		return nil, err
	}
	query.Search = structuredSearch.Text
	if structuredSearch.MediaType != "" {
		query.MediaType = structuredSearch.MediaType
	}
	if structuredSearch.Hidden != nil {
		if *structuredSearch.Hidden {
			query.Visibility = "hidden"
		} else {
			query.Visibility = "visible"
		}
	}
	if structuredSearch.DateFrom != nil {
		query.DateFrom = structuredSearch.DateFrom
	}
	if structuredSearch.DateTo != nil {
		query.DateTo = structuredSearch.DateTo
	}
	if query.Direction != "asc" {
		query.Direction = "desc"
	}
	if query.Visibility != "all" && query.Visibility != "hidden" {
		query.Visibility = "visible"
	}
	state := "ready"
	if query.Collection == "recently-deleted" {
		state = "trash"
	}
	sortExpression := "i.added_at"
	subquerySortExpression := "cursor_item.added_at"
	switch query.Sort {
	case "date-captured":
		sortExpression = "COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)"
		subquerySortExpression = "COALESCE(cursor_item.date_override,cursor_file.intrinsic_capture_at,cursor_file.original_uploaded_at)"
	case "name":
		sortExpression = "lower(i.display_name)"
		subquerySortExpression = "lower(cursor_item.display_name)"
	case "size":
		sortExpression = "b.byte_size"
		subquerySortExpression = "cursor_blob.byte_size"
	default:
		query.Sort = "recently-added"
	}
	items := []SpaceLibraryItem{}
	err = db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		conditions := []string{"i.space_id=$1", "i.lifecycle_state=$2"}
		if state == "ready" {
			conditions = append(conditions, "NOT EXISTS(SELECT 1 FROM space_library_asset_stack_members stack_member JOIN space_library_asset_stacks asset_stack ON asset_stack.id=stack_member.stack_id WHERE stack_member.space_library_item_id=i.id AND asset_stack.lifecycle_state='ready' AND asset_stack.cover_item_id<>i.id)")
		}
		args := []any{spaceID, state}
		addArgument := func(value any) string {
			args = append(args, value)
			return fmt.Sprintf("$%d", len(args))
		}
		switch query.Visibility {
		case "visible":
			conditions = append(conditions, "i.hidden=FALSE")
		case "hidden":
			conditions = append(conditions, "i.hidden=TRUE")
		}
		if query.Favorite {
			conditions = append(conditions, "i.favorite=TRUE")
		}
		if structuredSearch.Favorite != nil {
			conditions = append(conditions, "i.favorite="+addArgument(*structuredSearch.Favorite))
		}
		for _, tag := range structuredSearch.Tags {
			conditions = append(conditions, "EXISTS(SELECT 1 FROM jsonb_array_elements_text(i.tags) search_tag WHERE lower(search_tag)=lower("+addArgument(tag)+"))")
		}
		if query.Search != "" {
			placeholder := addArgument(query.Search)
			conditions = append(conditions, "(to_tsvector('simple',i.display_name||' '||i.caption||' '||i.tags::text) @@ plainto_tsquery('simple',"+placeholder+") OR to_tsvector('simple',f.original_filename||' '||f.intrinsic_metadata::text) @@ plainto_tsquery('simple',"+placeholder+"))")
		}
		switch query.MediaType {
		case "image", "video", "audio":
			conditions = append(conditions, "b.server_detected_mime_type LIKE "+addArgument(query.MediaType+"/%"))
		case "document":
			conditions = append(conditions, "b.server_detected_mime_type NOT LIKE 'image/%' AND b.server_detected_mime_type NOT LIKE 'video/%' AND b.server_detected_mime_type NOT LIKE 'audio/%'")
		case "selfies", "live-photos", "portraits", "panoramas", "slo-mo", "cinematic", "bursts", "raw", "screenshots", "screen-recordings", "spatial":
			conditions = append(conditions, libraryMediaSubtypeCondition(query.MediaType))
		case "":
		default:
			return ErrLibraryInvalid
		}
		if query.AlbumID != "" {
			conditions = append(conditions, "EXISTS(SELECT 1 FROM space_album_items album_item JOIN space_albums album ON album.id=album_item.album_id WHERE album_item.space_library_item_id=i.id AND album.id="+addArgument(query.AlbumID)+" AND album.space_id=i.space_id)")
		}
		switch query.Utility {
		case "":
		case "recently-viewed":
			viewerPlaceholder := addArgument(userID)
			conditions = append(conditions, "EXISTS(SELECT 1 FROM space_library_item_views item_view WHERE item_view.space_id=i.space_id AND item_view.space_library_item_id=i.id AND item_view.user_id="+viewerPlaceholder+")")
			sortExpression = "(SELECT item_view.last_viewed_at FROM space_library_item_views item_view WHERE item_view.space_id=i.space_id AND item_view.space_library_item_id=i.id AND item_view.user_id=" + viewerPlaceholder + ")"
			subquerySortExpression = "(SELECT item_view.last_viewed_at FROM space_library_item_views item_view WHERE item_view.space_id=cursor_item.space_id AND item_view.space_library_item_id=cursor_item.id AND item_view.user_id=" + viewerPlaceholder + ")"
		case "recently-edited":
			conditions = append(conditions, "i.current_edit_version_id IS NOT NULL")
			sortExpression, subquerySortExpression = "i.updated_at", "cursor_item.updated_at"
		case "recently-shared":
			conditions = append(conditions, "(EXISTS(SELECT 1 FROM space_library_grants grant_record WHERE grant_record.source_space_id=i.space_id AND grant_record.source_item_id=i.id AND grant_record.state='active') OR EXISTS(SELECT 1 FROM space_message_library_references message_reference WHERE message_reference.space_id=i.space_id AND message_reference.space_library_item_id=i.id))")
		case "recently-saved":
			conditions = append(conditions, "EXISTS(SELECT 1 FROM space_message_attachments saved_attachment WHERE saved_attachment.space_id=i.space_id AND saved_attachment.promoted_item_id=i.id)")
			sortExpression, subquerySortExpression = "i.added_at", "cursor_item.added_at"
		case "recovered":
			conditions = append(conditions, "EXISTS(SELECT 1 FROM space_library_audit_events recovery_event WHERE recovery_event.space_id=i.space_id AND recovery_event.target_kind='library_item' AND recovery_event.target_id=i.id AND recovery_event.action='library.item.restored' AND recovery_event.outcome='success')")
			sortExpression, subquerySortExpression = "i.updated_at", "cursor_item.updated_at"
		case "imports":
			conditions = append(conditions, "EXISTS(SELECT 1 FROM space_library_imports import_record WHERE import_record.destination_space_id=i.space_id AND import_record.destination_item_id=i.id AND import_record.state='ready')")
		case "featured":
			conditions = append(conditions, "b.server_detected_mime_type LIKE 'image/%' AND (i.favorite OR EXISTS(SELECT 1 FROM library_derivatives featured_derivative WHERE featured_derivative.space_library_item_id=i.id AND featured_derivative.lifecycle_state='ready' AND featured_derivative.kind='ai_metadata' AND lower(featured_derivative.metadata::text) ~ '(featured|aesthetic|best shot|high quality)'))")
		case "screenshots":
			conditions = append(conditions, "(lower(f.original_filename) LIKE '%screenshot%' OR lower(f.intrinsic_metadata::text) LIKE '%screenshot%')")
		case "documents":
			conditions = append(conditions, "b.server_detected_mime_type NOT LIKE 'image/%' AND b.server_detected_mime_type NOT LIKE 'video/%' AND b.server_detected_mime_type NOT LIKE 'audio/%'")
		case "receipts", "handwriting", "illustrations", "qr-codes":
			keyword := map[string]string{"receipts": "receipt", "handwriting": "handwrit", "illustrations": "illustration", "qr-codes": "qr"}[query.Utility]
			conditions = append(conditions, "EXISTS(SELECT 1 FROM library_derivatives intelligence WHERE intelligence.space_library_item_id=i.id AND intelligence.lifecycle_state='ready' AND intelligence.kind='ai_metadata' AND lower(intelligence.metadata::text) LIKE "+addArgument("%"+keyword+"%")+")")
		default:
			return ErrLibraryInvalid
		}
		if structuredSearch.Album != "" {
			placeholder := addArgument(structuredSearch.Album)
			conditions = append(conditions, "EXISTS(SELECT 1 FROM space_album_items search_album_item JOIN space_albums search_album ON search_album.id=search_album_item.album_id WHERE search_album_item.space_library_item_id=i.id AND search_album.space_id=i.space_id AND (search_album.id="+placeholder+" OR lower(search_album.name)=lower("+placeholder+")))")
		}
		if query.DateFrom != nil {
			conditions = append(conditions, "COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)>="+addArgument(*query.DateFrom))
		}
		if query.DateTo != nil {
			conditions = append(conditions, "COALESCE(i.date_override,f.intrinsic_capture_at,f.original_uploaded_at)<"+addArgument(*query.DateTo))
		}
		if query.After != "" {
			operator := "<"
			if query.Direction == "asc" {
				operator = ">"
			}
			placeholder := addArgument(query.After)
			conditions = append(conditions, fmt.Sprintf("(%s,i.id)%s(SELECT %s,cursor_item.id FROM space_library_items cursor_item JOIN library_files cursor_file ON cursor_file.id=cursor_item.file_id JOIN library_blobs cursor_blob ON cursor_blob.id=cursor_file.blob_id WHERE cursor_item.id=%s AND cursor_item.space_id=$1)", sortExpression, operator, subquerySortExpression, placeholder))
		}
		args = append(args, query.Limit)
		statement := `SELECT i.id,i.space_id,i.file_id,i.contributing_user_id,i.display_name,i.caption,i.tags,i.favorite,i.hidden,i.date_override,COALESCE(i.location_override,'null'::jsonb),i.contributor_information,COALESCE(i.current_edit_version_id,''),i.added_by_user_id,i.lifecycle_state,i.added_at,i.trashed_at,i.recover_until,i.version,i.updated_at,
			f.id,f.blob_id,f.security_domain_id,f.uploader_user_id,f.original_filename,f.intrinsic_metadata,f.lifecycle_state,f.original_uploaded_at,f.version
			FROM space_library_items i JOIN library_files f ON f.id=i.file_id JOIN library_blobs b ON b.id=f.blob_id
			WHERE ` + strings.Join(conditions, " AND ") + ` ORDER BY ` + sortExpression + ` ` + strings.ToUpper(query.Direction) + `,i.id ` + strings.ToUpper(query.Direction) + ` LIMIT $` + strconv.Itoa(len(args))
		rows, err := tx.QueryContext(ctx, statement, args...)
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

func libraryMediaSubtypeCondition(kind string) string {
	metadata := `lower(f.original_filename||' '||f.intrinsic_metadata::text||' '||COALESCE((SELECT string_agg(d.metadata::text,' ') FROM library_derivatives d WHERE d.space_library_item_id=i.id AND d.lifecycle_state='ready' AND d.kind='ai_metadata'),''))`
	switch kind {
	case "selfies":
		return "b.server_detected_mime_type LIKE 'image/%' AND " + metadata + " ~ '(selfie|front.camera)'"
	case "live-photos":
		return "(EXISTS(SELECT 1 FROM space_library_asset_stacks asset_stack WHERE asset_stack.space_id=i.space_id AND asset_stack.cover_item_id=i.id AND asset_stack.kind='live_photo' AND asset_stack.lifecycle_state='ready') OR b.server_detected_mime_type LIKE 'image/%' AND " + metadata + " ~ '(live.photo|motion.photo)')"
	case "portraits":
		return "b.server_detected_mime_type LIKE 'image/%' AND " + metadata + " ~ '(portrait|depth.effect)'"
	case "panoramas":
		return "b.server_detected_mime_type LIKE 'image/%' AND " + metadata + " ~ '(panorama|pano)'"
	case "slo-mo":
		return "b.server_detected_mime_type LIKE 'video/%' AND " + metadata + " ~ '(slo.mo|slow.motion|high.frame.rate)'"
	case "cinematic":
		return "b.server_detected_mime_type LIKE 'video/%' AND " + metadata + " ~ '(cinematic|depth.video)'"
	case "bursts":
		return "(EXISTS(SELECT 1 FROM space_library_asset_stacks asset_stack WHERE asset_stack.space_id=i.space_id AND asset_stack.cover_item_id=i.id AND asset_stack.kind='burst' AND asset_stack.lifecycle_state='ready') OR b.server_detected_mime_type LIKE 'image/%' AND " + metadata + " ~ '(burst|burst.identifier)')"
	case "raw":
		return "(EXISTS(SELECT 1 FROM space_library_asset_stacks asset_stack WHERE asset_stack.space_id=i.space_id AND asset_stack.cover_item_id=i.id AND asset_stack.kind='raw_pair' AND asset_stack.lifecycle_state='ready') OR lower(f.original_filename) ~ '\\.(dng|cr2|cr3|nef|nrw|arw|srf|sr2|raf|rw2|orf|pef|x3f)$')"
	case "screenshots":
		return "b.server_detected_mime_type LIKE 'image/%' AND " + metadata + " ~ '(screenshot|screen.shot)'"
	case "screen-recordings":
		return "b.server_detected_mime_type LIKE 'video/%' AND " + metadata + " ~ '(screen.recording|screen.capture)'"
	case "spatial":
		return "(b.server_detected_mime_type LIKE 'image/%' OR b.server_detected_mime_type LIKE 'video/%') AND " + metadata + " ~ '(spatial|stereo.scopic|vision.pro)'"
	default:
		return "FALSE"
	}
}

func parseLibrarySearch(input string) (parsedLibrarySearch, error) {
	parsed := parsedLibrarySearch{}
	textTokens := []string{}
	for _, token := range splitLibrarySearchTokens(input) {
		key, value, structured := strings.Cut(token, ":")
		key, value = strings.ToLower(strings.TrimSpace(key)), strings.TrimSpace(value)
		if !structured || value == "" {
			textTokens = append(textTokens, token)
			continue
		}
		switch key {
		case "tag":
			if len([]rune(value)) > 80 {
				return parsed, ErrLibraryInvalid
			}
			parsed.Tags = append(parsed.Tags, value)
		case "type":
			switch strings.ToLower(value) {
			case "image", "images", "photo", "photos":
				parsed.MediaType = "image"
			case "video", "videos":
				parsed.MediaType = "video"
			case "audio":
				parsed.MediaType = "audio"
			case "document", "documents", "file", "files":
				parsed.MediaType = "document"
			case "selfie", "selfies":
				parsed.MediaType = "selfies"
			case "live-photo", "live-photos":
				parsed.MediaType = "live-photos"
			case "portrait", "portraits":
				parsed.MediaType = "portraits"
			case "panorama", "panoramas", "pano":
				parsed.MediaType = "panoramas"
			case "slo-mo", "slow-motion":
				parsed.MediaType = "slo-mo"
			case "cinematic":
				parsed.MediaType = "cinematic"
			case "burst", "bursts":
				parsed.MediaType = "bursts"
			case "screenshot", "screenshots":
				parsed.MediaType = "screenshots"
			case "screen-recording", "screen-recordings":
				parsed.MediaType = "screen-recordings"
			case "spatial":
				parsed.MediaType = "spatial"
			default:
				return parsed, ErrLibraryInvalid
			}
		case "album":
			if len([]rune(value)) > 120 {
				return parsed, ErrLibraryInvalid
			}
			parsed.Album = value
		case "favorite", "hidden":
			boolean, parseErr := strconv.ParseBool(strings.ToLower(value))
			if parseErr != nil {
				return parsed, ErrLibraryInvalid
			}
			if key == "favorite" {
				parsed.Favorite = &boolean
			} else {
				parsed.Hidden = &boolean
			}
		case "after", "before":
			date, parseErr := time.Parse("2006-01-02", value)
			if parseErr != nil {
				return parsed, ErrLibraryInvalid
			}
			if key == "after" {
				parsed.DateFrom = &date
			} else {
				parsed.DateTo = &date
			}
		case "year":
			year, parseErr := strconv.Atoi(value)
			if parseErr != nil || year < 1 || year > 9999 {
				return parsed, ErrLibraryInvalid
			}
			from := time.Date(year, time.January, 1, 0, 0, 0, 0, time.UTC)
			to := from.AddDate(1, 0, 0)
			parsed.DateFrom, parsed.DateTo = &from, &to
		default:
			textTokens = append(textTokens, token)
		}
	}
	parsed.Text = strings.Join(textTokens, " ")
	return parsed, nil
}

func splitLibrarySearchTokens(input string) []string {
	tokens := []string{}
	var current strings.Builder
	quoted := false
	for _, char := range input {
		switch {
		case char == '"':
			quoted = !quoted
		case !quoted && (char == ' ' || char == '\t' || char == '\n'):
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
		default:
			current.WriteRune(char)
		}
	}
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}
	return tokens
}

func (db *Database) BulkUpdateLibraryItems(ctx context.Context, userID, spaceID string, operation BulkLibraryItemOperation) ([]SpaceLibraryItem, error) {
	if len(operation.Items) < 1 || len(operation.Items) > 200 {
		return nil, ErrLibraryInvalid
	}
	versions := make(map[string]int64, len(operation.Items))
	ids := make([]string, 0, len(operation.Items))
	for _, item := range operation.Items {
		if strings.TrimSpace(item.ID) == "" || item.Version < 1 {
			return nil, ErrLibraryInvalid
		}
		if _, duplicate := versions[item.ID]; duplicate {
			return nil, ErrLibraryInvalid
		}
		versions[item.ID] = item.Version
		ids = append(ids, item.ID)
	}
	allowedAction := map[string]bool{
		"favorite": true, "unfavorite": true, "hide": true, "unhide": true,
		"trash": true, "restore": true, "add_to_album": true, "remove_from_album": true,
		"add_tags": true, "remove_tags": true, "set_date": true, "clear_date": true,
		"set_location": true, "clear_location": true,
	}
	if !allowedAction[operation.Action] || (operation.Action == "add_to_album" || operation.Action == "remove_from_album") && operation.AlbumID == "" {
		return nil, ErrLibraryInvalid
	}
	if operation.Action == "add_tags" || operation.Action == "remove_tags" {
		operation.Tags = normalizeLibraryTags(operation.Tags)
		if len(operation.Tags) < 1 || len(operation.Tags) > 100 {
			return nil, ErrLibraryInvalid
		}
	}
	if operation.Action == "set_date" && operation.DateOverride == nil {
		return nil, ErrLibraryInvalid
	}
	if operation.Action == "set_location" {
		var location map[string]any
		if len(operation.LocationOverride) < 2 || len(operation.LocationOverride) > 4096 || json.Unmarshal(operation.LocationOverride, &location) != nil || len(location) == 0 {
			return nil, ErrLibraryInvalid
		}
	}

	items := []SpaceLibraryItem{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT id,version,lifecycle_state FROM space_library_items WHERE space_id=$1 AND id=ANY($2) FOR UPDATE`, spaceID, pq.Array(ids))
		if err != nil {
			return err
		}
		found := 0
		states := make(map[string]string, len(ids))
		for rows.Next() {
			var id, state string
			var version int64
			if err := rows.Scan(&id, &version, &state); err != nil {
				_ = rows.Close()
				return err
			}
			if versions[id] != version {
				_ = rows.Close()
				return ErrLibraryConflict
			}
			states[id] = state
			found++
		}
		if err := rows.Close(); err != nil {
			return err
		}
		if found != len(ids) {
			return ErrLibraryNotFound
		}
		requireState := "ready"
		if operation.Action == "restore" {
			requireState = "trash"
		}
		for _, id := range ids {
			if states[id] != requireState {
				return ErrLibraryConflict
			}
		}

		switch operation.Action {
		case "favorite", "unfavorite":
			_, err = tx.ExecContext(ctx, `UPDATE space_library_items SET favorite=$1,version=version+1,updated_at=NOW() WHERE space_id=$2 AND id=ANY($3)`, operation.Action == "favorite", spaceID, pq.Array(ids))
		case "hide", "unhide":
			_, err = tx.ExecContext(ctx, `UPDATE space_library_items SET hidden=$1,version=version+1,updated_at=NOW() WHERE space_id=$2 AND id=ANY($3)`, operation.Action == "hide", spaceID, pq.Array(ids))
		case "trash":
			_, err = tx.ExecContext(ctx, `UPDATE space_library_items SET lifecycle_state='trash',trashed_at=NOW(),recover_until=NOW()+$1::interval,version=version+1,updated_at=NOW() WHERE space_id=$2 AND id=ANY($3)`, "30 days", spaceID, pq.Array(ids))
			if err == nil {
				_, err = tx.ExecContext(ctx, `UPDATE space_storage_contributions SET state='recovery',updated_at=NOW() WHERE space_id=$1 AND source_kind='library_item' AND source_id=ANY($2) AND state='active'`, spaceID, pq.Array(ids))
			}
		case "restore":
			result, updateErr := tx.ExecContext(ctx, `UPDATE space_library_items SET lifecycle_state='ready',trashed_at=NULL,recover_until=NULL,version=version+1,updated_at=NOW() WHERE space_id=$1 AND id=ANY($2) AND recover_until>NOW()`, spaceID, pq.Array(ids))
			err = updateErr
			if err == nil {
				if count, _ := result.RowsAffected(); count != int64(len(ids)) {
					return ErrLibraryNotFound
				}
				_, err = tx.ExecContext(ctx, `UPDATE space_storage_contributions SET state='active',updated_at=NOW() WHERE space_id=$1 AND source_kind='library_item' AND source_id=ANY($2) AND state='recovery'`, spaceID, pq.Array(ids))
			}
		case "add_to_album", "remove_from_album":
			var albumExists bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_albums WHERE id=$1 AND space_id=$2)`, operation.AlbumID, spaceID).Scan(&albumExists); err != nil || !albumExists {
				return ErrLibraryNotFound
			}
			if operation.Action == "add_to_album" {
				_, err = tx.ExecContext(ctx, `INSERT INTO space_album_items(album_id,space_library_item_id,added_by_user_id) SELECT $1,unnest($2::text[]),$3 ON CONFLICT DO NOTHING`, operation.AlbumID, pq.Array(ids), userID)
			} else {
				_, err = tx.ExecContext(ctx, `DELETE FROM space_album_items WHERE album_id=$1 AND space_library_item_id=ANY($2)`, operation.AlbumID, pq.Array(ids))
			}
			if err == nil {
				_, err = tx.ExecContext(ctx, `UPDATE space_albums SET version=version+1,updated_at=NOW() WHERE id=$1`, operation.AlbumID)
			}
		case "add_tags":
			raw, _ := json.Marshal(operation.Tags)
			_, err = tx.ExecContext(ctx, `UPDATE space_library_items i SET tags=(SELECT COALESCE(jsonb_agg(value ORDER BY lower(value)),'[]'::jsonb) FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(i.tags||$1::jsonb) value) tags),version=version+1,updated_at=NOW() WHERE i.space_id=$2 AND i.id=ANY($3)`, raw, spaceID, pq.Array(ids))
		case "remove_tags":
			_, err = tx.ExecContext(ctx, `UPDATE space_library_items i SET tags=(SELECT COALESCE(jsonb_agg(value ORDER BY lower(value)),'[]'::jsonb) FROM jsonb_array_elements_text(i.tags) value WHERE lower(value)<>ALL($1::text[])),version=version+1,updated_at=NOW() WHERE i.space_id=$2 AND i.id=ANY($3)`, pq.Array(lowerStrings(operation.Tags)), spaceID, pq.Array(ids))
		case "set_date":
			_, err = tx.ExecContext(ctx, `UPDATE space_library_items SET date_override=$1,version=version+1,updated_at=NOW() WHERE space_id=$2 AND id=ANY($3)`, *operation.DateOverride, spaceID, pq.Array(ids))
		case "clear_date":
			_, err = tx.ExecContext(ctx, `UPDATE space_library_items SET date_override=NULL,version=version+1,updated_at=NOW() WHERE space_id=$1 AND id=ANY($2)`, spaceID, pq.Array(ids))
		case "set_location":
			_, err = tx.ExecContext(ctx, `UPDATE space_library_items SET location_override=$1,version=version+1,updated_at=NOW() WHERE space_id=$2 AND id=ANY($3)`, operation.LocationOverride, spaceID, pq.Array(ids))
		case "clear_location":
			_, err = tx.ExecContext(ctx, `UPDATE space_library_items SET location_override=NULL,version=version+1,updated_at=NOW() WHERE space_id=$1 AND id=ANY($2)`, spaceID, pq.Array(ids))
		}
		if err != nil {
			return err
		}
		if err := insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.items.bulk."+operation.Action, "library_items", "", "success", map[string]any{"count": len(ids), "album_id": operation.AlbumID}); err != nil {
			return err
		}
		if operation.Action == "trash" || operation.Action == "restore" {
			action := "library.item.trashed"
			if operation.Action == "restore" {
				action = "library.item.restored"
			}
			for _, id := range ids {
				if err := insertLibraryAuditTx(ctx, tx, spaceID, "", userID, action, "library_item", id, "success", map[string]any{"bulk": true}); err != nil {
					return err
				}
			}
		}
		updatedRows, err := tx.QueryContext(ctx, libraryItemSelect+` WHERE i.space_id=$1 AND i.id=ANY($2) ORDER BY array_position($2::text[],i.id)`, spaceID, pq.Array(ids))
		if err != nil {
			return err
		}
		defer updatedRows.Close()
		for updatedRows.Next() {
			var item SpaceLibraryItem
			if err := scanSpaceLibraryItem(updatedRows, &item); err != nil {
				return err
			}
			items = append(items, item)
		}
		return updatedRows.Err()
	})
	return items, err
}

func (db *Database) UpdateLibraryItem(ctx context.Context, userID, spaceID, itemID string, version int64, displayName, caption string, tags []string, favorite, hidden bool) (*SpaceLibraryItem, error) {
	displayName = strings.TrimSpace(displayName)
	caption = strings.TrimSpace(caption)
	if displayName == "" || len([]rune(displayName)) > 255 || len([]rune(caption)) > 4000 || len(tags) > 100 {
		return nil, ErrLibraryInvalid
	}
	encodedTags, _ := json.Marshal(normalizeLibraryTags(tags))
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryEdit); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE space_library_items SET display_name=$1,caption=$2,tags=$3,favorite=$4,hidden=$5,version=version+1,updated_at=NOW() WHERE id=$6 AND space_id=$7 AND version=$8 AND lifecycle_state='ready'`, displayName, caption, encodedTags, favorite, hidden, itemID, spaceID, version)
		if err != nil {
			return err
		}
		if n, _ := result.RowsAffected(); n == 0 {
			return ErrLibraryConflict
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, "", userID, "library.item.updated", "library_item", itemID, "success", map[string]any{"version": version + 1})
	})
	if err != nil {
		return nil, err
	}
	return db.LibraryItem(ctx, userID, spaceID, itemID)
}

func (db *Database) LibraryItem(ctx context.Context, userID, spaceID, itemID string) (*SpaceLibraryItem, error) {
	out := &SpaceLibraryItem{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView); err != nil {
			return err
		}
		return scanSpaceLibraryItem(tx.QueryRowContext(ctx, `SELECT i.id,i.space_id,i.file_id,i.contributing_user_id,i.display_name,i.caption,i.tags,i.favorite,i.hidden,i.date_override,COALESCE(i.location_override,'null'::jsonb),i.contributor_information,COALESCE(i.current_edit_version_id,''),i.added_by_user_id,i.lifecycle_state,i.added_at,i.trashed_at,i.recover_until,i.version,i.updated_at,
			f.id,f.blob_id,f.security_domain_id,f.uploader_user_id,f.original_filename,f.intrinsic_metadata,f.lifecycle_state,f.original_uploaded_at,f.version FROM space_library_items i JOIN library_files f ON f.id=i.file_id WHERE i.id=$1 AND i.space_id=$2`, itemID, spaceID), out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLibraryNotFound
	}
	return out, err
}

func (db *Database) PromoteMessageAttachment(ctx context.Context, userID, spaceID, attachmentID string) (*SpaceLibraryItem, error) {
	item := &SpaceLibraryItem{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryAdd); err != nil {
			return err
		}
		var attachment MessageAttachment
		if err := scanMessageAttachment(tx.QueryRowContext(ctx, `SELECT id,space_id,COALESCE(message_id,''),file_id,upload_id,uploader_user_id,display_name,COALESCE(promoted_item_id,''),lifecycle_state,created_at,deleted_at,recover_until FROM space_message_attachments WHERE id=$1 AND space_id=$2 FOR UPDATE`, attachmentID, spaceID), &attachment); err != nil {
			return err
		}
		if attachment.PromotedItemID != "" {
			return scanSpaceLibraryItem(tx.QueryRowContext(ctx, libraryItemSelect+` WHERE i.id=$1 AND i.space_id=$2`, attachment.PromotedItemID, spaceID), item)
		}
		item.ID, item.SpaceID, item.FileID, item.ContributingUserID, item.DisplayName, item.AddedByUserID, item.LifecycleState, item.Version = "item_"+uuid.NewString(), spaceID, attachment.FileID, attachment.UploaderUserID, attachment.DisplayName, userID, "ready", 1
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_library_items(id,space_id,file_id,contributing_user_id,display_name,added_by_user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING added_at,updated_at`, item.ID, spaceID, attachment.FileID, attachment.UploaderUserID, attachment.DisplayName, userID).Scan(&item.AddedAt, &item.UpdatedAt); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_message_attachments SET promoted_item_id=$1 WHERE id=$2`, item.ID, attachment.ID); err != nil {
			return err
		}
		if err := insertDefaultAliasTx(ctx, tx, spaceID, "library_item", item.ID, userID); err != nil {
			return err
		}
		if err := scanLibraryFile(tx.QueryRowContext(ctx, `SELECT id,blob_id,security_domain_id,uploader_user_id,original_filename,intrinsic_metadata,lifecycle_state,original_uploaded_at,version FROM library_files WHERE id=$1`, item.FileID), &item.File); err != nil {
			return err
		}
		return insertLibraryAuditTx(ctx, tx, spaceID, item.File.SecurityDomainID, userID, "library.item.promoted", "library_item", item.ID, "success", map[string]any{"attachment_id": attachment.ID})
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLibraryNotFound
	}
	return item, err
}

func (db *Database) LibraryItemDownload(ctx context.Context, userID, spaceID, itemID string) (*LibraryDownload, error) {
	out := &LibraryDownload{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryDownload); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(rb.r2_object_key,b.r2_object_key),i.display_name,COALESCE(rb.server_detected_mime_type,b.server_detected_mime_type),COALESCE(rb.byte_size,b.byte_size),COALESCE(rb.sha256,b.sha256),(rb.id IS NOT NULL)
			FROM space_library_items i JOIN library_files f ON f.id=i.file_id JOIN library_blobs b ON b.id=f.blob_id
			LEFT JOIN library_item_versions v ON v.id=i.current_edit_version_id AND v.lifecycle_state='ready' AND v.rendition_state='ready'
			LEFT JOIN library_blobs rb ON rb.id=v.rendition_blob_id AND rb.lifecycle_state='ready'
			WHERE i.id=$1 AND i.space_id=$2 AND i.lifecycle_state='ready' AND f.lifecycle_state='ready' AND b.lifecycle_state='ready'`, itemID, spaceID).
			Scan(&out.ObjectKey, &out.Filename, &out.MIMEType, &out.ByteSize, &out.SHA256, &out.Rendition); err != nil {
			return err
		}
		return recordLibraryItemViewTx(ctx, tx, userID, spaceID, itemID)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLibraryNotFound
	}
	return out, err
}

func (db *Database) LibraryOriginalItemDownload(ctx context.Context, userID, spaceID, itemID string) (*LibraryDownload, error) {
	out := &LibraryDownload{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryDownload); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `SELECT b.r2_object_key,f.original_filename,b.server_detected_mime_type,b.byte_size,b.sha256
			FROM space_library_items i JOIN library_files f ON f.id=i.file_id JOIN library_blobs b ON b.id=f.blob_id
			WHERE i.id=$1 AND i.space_id=$2 AND i.lifecycle_state='ready' AND f.lifecycle_state='ready' AND b.lifecycle_state='ready'`, itemID, spaceID).
			Scan(&out.ObjectKey, &out.Filename, &out.MIMEType, &out.ByteSize, &out.SHA256); err != nil {
			return err
		}
		return recordLibraryItemViewTx(ctx, tx, userID, spaceID, itemID)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLibraryNotFound
	}
	return out, err
}

func recordLibraryItemViewTx(ctx context.Context, tx *sql.Tx, userID, spaceID, itemID string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO space_library_item_views(space_id,space_library_item_id,user_id) VALUES($1,$2,$3)
		ON CONFLICT(space_id,space_library_item_id,user_id) DO UPDATE SET view_count=space_library_item_views.view_count+1,last_viewed_at=NOW()`, spaceID, itemID, userID)
	return err
}

func (db *Database) MessageAttachmentDownload(ctx context.Context, userID, spaceID, attachmentID string) (*LibraryDownload, error) {
	out := &LibraryDownload{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead); err != nil {
			return ErrLibraryForbidden
		}
		return tx.QueryRowContext(ctx, `SELECT b.r2_object_key,a.display_name,b.server_detected_mime_type,b.byte_size,b.sha256
			FROM space_message_attachments a JOIN library_files f ON f.id=a.file_id JOIN library_blobs b ON b.id=f.blob_id
			WHERE a.id=$1 AND a.space_id=$2 AND a.lifecycle_state='ready' AND f.lifecycle_state='ready' AND b.lifecycle_state='ready'`, attachmentID, spaceID).
			Scan(&out.ObjectKey, &out.Filename, &out.MIMEType, &out.ByteSize, &out.SHA256)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLibraryNotFound
	}
	return out, err
}

const libraryItemSelect = `SELECT i.id,i.space_id,i.file_id,i.contributing_user_id,i.display_name,i.caption,i.tags,i.favorite,i.hidden,i.date_override,COALESCE(i.location_override,'null'::jsonb),i.contributor_information,COALESCE(i.current_edit_version_id,''),i.added_by_user_id,i.lifecycle_state,i.added_at,i.trashed_at,i.recover_until,i.version,i.updated_at,
	f.id,f.blob_id,f.security_domain_id,f.uploader_user_id,f.original_filename,f.intrinsic_metadata,f.lifecycle_state,f.original_uploaded_at,f.version FROM space_library_items i JOIN library_files f ON f.id=i.file_id`

func loadCompletedLibraryUploadTx(ctx context.Context, tx *sql.Tx, upload *LibraryUpload, result *CompleteLibraryUploadResult) error {
	if err := scanLibraryFile(tx.QueryRowContext(ctx, `SELECT id,blob_id,security_domain_id,uploader_user_id,original_filename,intrinsic_metadata,lifecycle_state,original_uploaded_at,version FROM library_files WHERE id=$1`, upload.FileID), &result.File); err != nil {
		return err
	}
	if upload.Purpose == "library" {
		item := &SpaceLibraryItem{}
		if err := scanSpaceLibraryItem(tx.QueryRowContext(ctx, libraryItemSelect+` WHERE i.file_id=$1 AND i.space_id=$2 AND i.added_by_user_id=$3 ORDER BY i.added_at DESC LIMIT 1`, upload.FileID, upload.SpaceID, upload.UserID), item); err != nil {
			return err
		}
		result.Item = item
	} else if upload.Purpose == UploadPurposeNoteAttachment {
		asset := &SpaceNoteAsset{}
		if err := tx.QueryRowContext(
			ctx,
			`SELECT id,note_id,file_id,uploader_user_id,display_name,
			        lifecycle_state,created_at
			 FROM space_note_assets
			 WHERE file_id=$1`,
			upload.FileID,
		).Scan(
			&asset.ID, &asset.NoteID, &asset.FileID,
			&asset.UploaderUserID, &asset.DisplayName,
			&asset.LifecycleState, &asset.CreatedAt,
		); err != nil {
			return err
		}
		result.NoteAsset = asset
	} else if upload.Purpose == UploadPurposeDrawingAsset {
		asset := &SpaceDrawingAsset{}
		if err := scanSpaceDrawingAsset(tx.QueryRowContext(
			ctx,
			`SELECT a.id,a.drawing_id,a.file_id,a.uploader_user_id,
			        a.excalidraw_file_id,a.display_name,a.lifecycle_state,
			        a.created_at,
			        COALESCE(b.server_detected_mime_type,b.client_declared_mime_type),
			        b.byte_size,b.sha256
			 FROM space_drawing_assets a
			 JOIN library_files f ON f.id=a.file_id
			 JOIN library_blobs b ON b.id=f.blob_id
			 WHERE a.file_id=$1`,
			upload.FileID,
		), asset); err != nil {
			return err
		}
		result.DrawingAsset = asset
	} else {
		attachment := &MessageAttachment{}
		if err := scanMessageAttachment(tx.QueryRowContext(ctx, `SELECT id,space_id,COALESCE(message_id,''),file_id,upload_id,uploader_user_id,display_name,COALESCE(promoted_item_id,''),lifecycle_state,created_at,deleted_at,recover_until FROM space_message_attachments WHERE upload_id=$1`, upload.ID), attachment); err != nil {
			return err
		}
		result.Attachment = attachment
	}
	return nil
}

func insertDefaultAliasTx(ctx context.Context, tx *sql.Tx, spaceID, kind, targetID, userID string) error {
	raw := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	alias := strings.TrimSuffix(kind, "_item") + "_" + raw
	_, err := tx.ExecContext(ctx, `INSERT INTO space_item_aliases(id,space_id,target_kind,target_id,alias,normalized_alias,created_by_user_id) VALUES($1,$2,$3,$4,$5,$5,$6)`, "alias_"+uuid.NewString(), spaceID, kind, targetID, alias, userID)
	return err
}

func insertLibraryAuditTx(ctx context.Context, tx *sql.Tx, spaceID, domainID, userID, action, targetKind, targetID, outcome string, details any) error {
	raw, err := json.Marshal(details)
	if err != nil {
		return err
	}
	requestHash := sha256.Sum256([]byte(uuid.NewString()))
	var securityDomainID any
	if domainID != "" {
		securityDomainID = domainID
	}
	var actorUserID any
	if userID != "" {
		actorUserID = userID
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO space_library_audit_events(request_id,security_domain_id,space_id,actor_user_id,action,target_kind,target_id,outcome,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, "req_"+hex.EncodeToString(requestHash[:8]), securityDomainID, spaceID, actorUserID, action, targetKind, targetID, outcome, raw); err != nil {
		return err
	}
	if outcome != "success" || !libraryAuditRequiresRealtime(action) {
		return nil
	}
	_, err = recordSpaceEventTx(ctx, tx, spaceID, userID, action, targetID, map[string]any{
		"action":      action,
		"target_kind": targetKind,
		"target_id":   targetID,
		"outcome":     outcome,
	})
	return err
}

func libraryAuditRequiresRealtime(action string) bool {
	for _, prefix := range []string{
		"library.item.",
		"library.items.",
		"library.album.",
		"library.album_folder.",
		"library.asset_stack.",
		"library.edit.",
		"library.people.",
		"library.intelligence.",
		"library.memory.",
		"library.duplicates.",
		"library.pins.",
		"library.import.",
		"library.grant.",
	} {
		if strings.HasPrefix(action, prefix) {
			return true
		}
	}
	return false
}

func normalizeLibraryTags(tags []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(tags))
	for _, value := range tags {
		value = strings.TrimSpace(value)
		key := strings.ToLower(value)
		if value == "" || len([]rune(value)) > 80 || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, value)
	}
	return out
}

func lowerStrings(values []string) []string {
	out := make([]string, len(values))
	for index, value := range values {
		out[index] = strings.ToLower(value)
	}
	return out
}

func scanLibraryUpload(scanner interface{ Scan(...any) error }, out *LibraryUpload) error {
	return scanner.Scan(&out.ID, &out.SpaceID, &out.SecurityDomainID, &out.UserID, &out.ObjectKey, &out.OriginalFilename, &out.Purpose, &out.ClientDeclaredMIMEType, &out.RequestedByteSize, &out.ClientSHA256, &out.VerifiedByteSize, &out.VerifiedSHA256, &out.DetectedMIMEType, &out.State, &out.FileID, &out.UploadTokenHash, &out.ErrorCode, &out.ExpiresAt, &out.Version, &out.CreatedAt, &out.UpdatedAt)
}

func scanLibraryFile(scanner interface{ Scan(...any) error }, out *LibraryFile) error {
	return scanner.Scan(&out.ID, &out.BlobID, &out.SecurityDomainID, &out.UploaderUserID, &out.OriginalFilename, &out.IntrinsicMetadata, &out.LifecycleState, &out.OriginalUploadedAt, &out.Version)
}

func scanSpaceLibraryItem(scanner interface{ Scan(...any) error }, out *SpaceLibraryItem) error {
	var tags []byte
	err := scanner.Scan(&out.ID, &out.SpaceID, &out.FileID, &out.ContributingUserID, &out.DisplayName, &out.Caption, &tags, &out.Favorite, &out.Hidden, &out.DateOverride, &out.LocationOverride, &out.ContributorInformation, &out.CurrentEditVersionID, &out.AddedByUserID, &out.LifecycleState, &out.AddedAt, &out.TrashedAt, &out.RecoverUntil, &out.Version, &out.UpdatedAt,
		&out.File.ID, &out.File.BlobID, &out.File.SecurityDomainID, &out.File.UploaderUserID, &out.File.OriginalFilename, &out.File.IntrinsicMetadata, &out.File.LifecycleState, &out.File.OriginalUploadedAt, &out.File.Version)
	if err == nil {
		_ = json.Unmarshal(tags, &out.Tags)
	}
	return err
}

func scanMessageAttachment(scanner interface{ Scan(...any) error }, out *MessageAttachment) error {
	return scanner.Scan(&out.ID, &out.SpaceID, &out.MessageID, &out.FileID, &out.UploadID, &out.UploaderUserID, &out.DisplayName, &out.PromotedItemID, &out.LifecycleState, &out.CreatedAt, &out.DeletedAt, &out.RecoverUntil)
}
