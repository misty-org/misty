package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

const (
	MaxAgentAttachmentsPerJob = 10
	MaxAgentAttachmentBytes   = int64(50 << 20)
	MaxAgentDocumentPages     = 200
)

var (
	ErrAgentAttachmentNotFound = errors.New("agent attachment not found")
	ErrAgentAttachmentExpired  = errors.New("agent attachment expired")
	ErrAgentAttachmentLimit    = errors.New("agent attachment limit exceeded")
	ErrAgentDocumentPageLimit  = errors.New("agent document page limit exceeded")
	ErrAgentAttachmentEnvelope = errors.New("agent attachments must share one job encryption envelope")
	ErrAgentCloudConsent       = errors.New("agent cloud document consent required")
	ErrAgentAttachmentToken    = errors.New("invalid agent attachment upload token")
)

type AgentAttachment struct {
	ID                 string     `json:"id"`
	JobID              string     `json:"jobId"`
	OwnerUserID        string     `json:"ownerUserId"`
	RequesterUserID    string     `json:"requesterUserId"`
	DocumentID         string     `json:"documentId"`
	DisplayName        string     `json:"displayName"`
	MediaType          string     `json:"mediaType"`
	PlaintextByteSize  int64      `json:"plaintextByteSize"`
	CiphertextByteSize int64      `json:"ciphertextByteSize"`
	PageCount          int        `json:"pageCount"`
	StorageKey         string     `json:"-"`
	CiphertextSHA256   string     `json:"ciphertextSha256"`
	WrappedDataKey     string     `json:"-"`
	KeyWrapAlgorithm   string     `json:"keyWrapAlgorithm"`
	KeyWrapKeyID       string     `json:"keyWrapKeyId"`
	ContentEncryption  string     `json:"contentEncryption"`
	UploadTokenHash    string     `json:"-"`
	State              string     `json:"state"`
	UploadExpiresAt    time.Time  `json:"uploadExpiresAt"`
	ExpiresAt          time.Time  `json:"expiresAt"`
	FinalizedAt        *time.Time `json:"finalizedAt,omitempty"`
	DeletedAt          *time.Time `json:"deletedAt,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
}

type AgentArtifact struct {
	ID               string          `json:"id"`
	JobID            string          `json:"jobId"`
	AgentID          string          `json:"agentId"`
	OwnerUserID      string          `json:"-"`
	ScopeID          string          `json:"scopeId"`
	Kind             string          `json:"kind"`
	DisplayName      string          `json:"fileName"`
	RelativeLocation string          `json:"relativePath,omitempty"`
	Citations        json.RawMessage `json:"citations"`
	CreatedAt        time.Time       `json:"createdAt"`
}

func (db *Database) RecordAgentArtifact(ctx context.Context, userID, jobID, scopeID, displayName, relativeLocation string, citations json.RawMessage) (*AgentArtifact, error) {
	if len(citations) == 0 {
		citations = json.RawMessage(`[]`)
	}
	out := &AgentArtifact{}
	err := db.withRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `INSERT INTO agent_artifacts(id,job_id,owner_user_id,scope_id,kind,display_name,relative_location,citations)
			SELECT $1,j.id,j.owner_user_id,$2,'file',$3,NULLIF($4,''),$5 FROM agent_jobs j
			WHERE j.id=$6 AND j.owner_user_id=$7 AND j.state='completed'
			AND EXISTS (SELECT 1 FROM agent_definitions a WHERE a.id=j.agent_id AND a.scope_id=$2 AND a.deleted_at IS NULL)
			ON CONFLICT(job_id,kind,display_name) DO UPDATE SET citations=EXCLUDED.citations
			RETURNING id,job_id,owner_user_id,scope_id,kind,display_name,COALESCE(relative_location,''),citations,created_at`,
			"artifact_"+uuid.NewString(), scopeID, displayName, relativeLocation, citations, jobID, userID).
			Scan(&out.ID, &out.JobID, &out.OwnerUserID, &out.ScopeID, &out.Kind, &out.DisplayName, &out.RelativeLocation, &out.Citations, &out.CreatedAt); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `SELECT COALESCE(agent_id,'') FROM agent_jobs WHERE id=$1`, jobID).Scan(&out.AgentID)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrAgentJobNotFound
	}
	return out, err
}

func (db *Database) AgentArtifacts(ctx context.Context, userID string, limit int) ([]AgentArtifact, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	out := make([]AgentArtifact, 0)
	err := db.withRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT a.id,a.job_id,COALESCE(j.agent_id,''),a.owner_user_id,a.scope_id,a.kind,a.display_name,COALESCE(a.relative_location,''),a.citations,a.created_at
			FROM agent_artifacts a JOIN agent_jobs j ON j.id=a.job_id ORDER BY a.created_at DESC LIMIT $1`, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var artifact AgentArtifact
			if err := rows.Scan(&artifact.ID, &artifact.JobID, &artifact.AgentID, &artifact.OwnerUserID, &artifact.ScopeID, &artifact.Kind, &artifact.DisplayName, &artifact.RelativeLocation, &artifact.Citations, &artifact.CreatedAt); err != nil {
				return err
			}
			out = append(out, artifact)
		}
		return rows.Err()
	})
	return out, err
}

// CreateAgentAttachment serializes allocation through the job row so concurrent
// initiations cannot exceed either the ten-file or 200-page task limit.
func (db *Database) CreateAgentAttachment(ctx context.Context, userID string, attachment AgentAttachment) (*AgentAttachment, error) {
	out := &AgentAttachment{}
	err := db.withRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		var ownerID, requesterID string
		var jobExpiresAt time.Time
		var cloudConsent bool
		err := tx.QueryRowContext(ctx, `SELECT j.owner_user_id,j.requester_user_id,j.expires_at,COALESCE(a.cloud_document_consent,FALSE)
			FROM agent_jobs j LEFT JOIN agent_definitions a ON a.id=j.agent_id
			WHERE j.id=$1 AND (j.owner_user_id=$2 OR j.requester_user_id=$2)
			AND j.state IN ('queued','leased','running','awaiting_approval') AND j.expires_at>NOW()
			FOR UPDATE OF j`, attachment.JobID, userID).Scan(&ownerID, &requesterID, &jobExpiresAt, &cloudConsent)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrAgentJobNotFound
		}
		if err != nil {
			return err
		}
		if !cloudConsent {
			return ErrAgentCloudConsent
		}

		var count, pages int
		var documentExists bool
		var wrappedDataKey, keyWrapAlgorithm, keyWrapKeyID, contentEncryption string
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(DISTINCT logical_document_id),COALESCE(SUM(page_count),0),
			COALESCE(BOOL_OR(logical_document_id=$2),FALSE),
			COALESCE(MIN(wrapped_data_key),''),COALESCE(MIN(key_wrap_algorithm),''),COALESCE(MIN(key_wrap_key_id),''),COALESCE(MIN(content_encryption),'')
			FROM agent_attachments WHERE job_id=$1 AND state<>'deleted' AND expires_at>NOW()`, attachment.JobID, attachment.DocumentID).
			Scan(&count, &pages, &documentExists, &wrappedDataKey, &keyWrapAlgorithm, &keyWrapKeyID, &contentEncryption); err != nil {
			return err
		}
		if count >= MaxAgentAttachmentsPerJob && !documentExists {
			return ErrAgentAttachmentLimit
		}
		if pages+attachment.PageCount > MaxAgentDocumentPages {
			return ErrAgentDocumentPageLimit
		}
		if count > 0 && (wrappedDataKey != attachment.WrappedDataKey || keyWrapAlgorithm != attachment.KeyWrapAlgorithm || keyWrapKeyID != attachment.KeyWrapKeyID || contentEncryption != attachment.ContentEncryption) {
			return ErrAgentAttachmentEnvelope
		}

		attachment.OwnerUserID = ownerID
		attachment.RequesterUserID = requesterID
		if attachment.ExpiresAt.After(jobExpiresAt) {
			attachment.ExpiresAt = jobExpiresAt
		}
		if attachment.UploadExpiresAt.After(attachment.ExpiresAt) {
			attachment.UploadExpiresAt = attachment.ExpiresAt
		}
		if attachment.CreatedAt.IsZero() {
			attachment.CreatedAt = time.Now().UTC()
		}
		return scanAgentAttachment(tx.QueryRowContext(ctx, `INSERT INTO agent_attachments(
			id,job_id,owner_user_id,requester_user_id,logical_document_id,display_name,media_type,plaintext_byte_size,
			ciphertext_byte_size,page_count,storage_key,ciphertext_sha256,wrapped_data_key,
			key_wrap_algorithm,key_wrap_key_id,content_encryption,upload_token_hash,upload_expires_at,expires_at,created_at)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
			RETURNING `+agentAttachmentColumns,
			attachment.ID, attachment.JobID, ownerID, requesterID, attachment.DocumentID, attachment.DisplayName,
			attachment.MediaType, attachment.PlaintextByteSize, attachment.CiphertextByteSize,
			attachment.PageCount, attachment.StorageKey, attachment.CiphertextSHA256,
			attachment.WrappedDataKey, attachment.KeyWrapAlgorithm, attachment.KeyWrapKeyID,
			attachment.ContentEncryption, attachment.UploadTokenHash, attachment.UploadExpiresAt,
			attachment.ExpiresAt, attachment.CreatedAt), out)
	})
	return out, err
}

func (db *Database) AgentAttachment(ctx context.Context, userID, jobID, attachmentID string) (*AgentAttachment, error) {
	out := &AgentAttachment{}
	err := db.withRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		return scanAgentAttachment(tx.QueryRowContext(ctx, `SELECT `+agentAttachmentColumns+` FROM agent_attachments
			WHERE id=$1 AND job_id=$2 AND (owner_user_id=$3 OR requester_user_id=$3)`, attachmentID, jobID, userID), out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrAgentAttachmentNotFound
	}
	return out, err
}

func (db *Database) FinalizeAgentAttachment(ctx context.Context, userID, jobID, attachmentID, uploadTokenHash string, byteSize int64, sha256 string) (*AgentAttachment, error) {
	out := &AgentAttachment{}
	err := db.withRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		err := scanAgentAttachment(tx.QueryRowContext(ctx, `UPDATE agent_attachments SET state='ready',finalized_at=COALESCE(finalized_at,NOW())
			WHERE id=$1 AND job_id=$2 AND (owner_user_id=$3 OR requester_user_id=$3)
			AND upload_token_hash=$4 AND ciphertext_byte_size=$5 AND ciphertext_sha256=$6
			AND state IN ('initiated','ready') AND upload_expires_at>NOW() AND expires_at>NOW()
			RETURNING `+agentAttachmentColumns, attachmentID, jobID, userID, uploadTokenHash, byteSize, sha256), out)
		if err == nil {
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var expiresAt, uploadExpiresAt time.Time
		var tokenHash string
		err = tx.QueryRowContext(ctx, `SELECT expires_at,upload_expires_at,upload_token_hash FROM agent_attachments
			WHERE id=$1 AND job_id=$2 AND (owner_user_id=$3 OR requester_user_id=$3)`, attachmentID, jobID, userID).
			Scan(&expiresAt, &uploadExpiresAt, &tokenHash)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrAgentAttachmentNotFound
		}
		if err != nil {
			return err
		}
		if time.Now().After(expiresAt) || time.Now().After(uploadExpiresAt) {
			return ErrAgentAttachmentExpired
		}
		if tokenHash != uploadTokenHash {
			return ErrAgentAttachmentToken
		}
		return ErrAgentAttachmentToken
	})
	return out, err
}

func (db *Database) DeleteAgentAttachment(ctx context.Context, userID, jobID, attachmentID string) (*AgentAttachment, error) {
	out := &AgentAttachment{}
	err := db.withRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		return scanAgentAttachment(tx.QueryRowContext(ctx, `UPDATE agent_attachments SET state='deleted',deleted_at=COALESCE(deleted_at,NOW()),wrapped_data_key=NULL
			WHERE id=$1 AND job_id=$2 AND (owner_user_id=$3 OR requester_user_id=$3)
			RETURNING `+agentAttachmentColumns, attachmentID, jobID, userID), out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrAgentAttachmentNotFound
	}
	return out, err
}

func (db *Database) ExpiredAgentAttachments(ctx context.Context, before time.Time, limit int) ([]AgentAttachment, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	out := []AgentAttachment{}
	err := db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT `+agentAttachmentColumns+` FROM agent_attachments
			WHERE expires_at<=$1 AND state<>'deleted' ORDER BY expires_at LIMIT $2`, before, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var attachment AgentAttachment
			if err := scanAgentAttachment(rows, &attachment); err != nil {
				return err
			}
			out = append(out, attachment)
		}
		return rows.Err()
	})
	return out, err
}

func (db *Database) MarkAgentAttachmentPurged(ctx context.Context, attachmentID string) error {
	return db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE agent_attachments SET state='deleted',deleted_at=COALESCE(deleted_at,NOW()),wrapped_data_key=NULL
			WHERE id=$1 AND expires_at<=NOW()`, attachmentID)
		return err
	})
}

const agentAttachmentColumns = `id,job_id,owner_user_id,requester_user_id,logical_document_id,display_name,media_type,
	plaintext_byte_size,ciphertext_byte_size,page_count,storage_key,ciphertext_sha256,COALESCE(wrapped_data_key,''),
	key_wrap_algorithm,key_wrap_key_id,content_encryption,upload_token_hash,state,upload_expires_at,expires_at,finalized_at,
	deleted_at,created_at`

func scanAgentAttachment(scanner scanner, attachment *AgentAttachment) error {
	return scanner.Scan(&attachment.ID, &attachment.JobID, &attachment.OwnerUserID, &attachment.RequesterUserID,
		&attachment.DocumentID, &attachment.DisplayName, &attachment.MediaType, &attachment.PlaintextByteSize,
		&attachment.CiphertextByteSize, &attachment.PageCount, &attachment.StorageKey,
		&attachment.CiphertextSHA256, &attachment.WrappedDataKey, &attachment.KeyWrapAlgorithm,
		&attachment.KeyWrapKeyID, &attachment.ContentEncryption, &attachment.UploadTokenHash, &attachment.State,
		&attachment.UploadExpiresAt, &attachment.ExpiresAt, &attachment.FinalizedAt,
		&attachment.DeletedAt, &attachment.CreatedAt)
}
