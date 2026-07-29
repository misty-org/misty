package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrAccountDeletionBlocked = errors.New("account deletion requires ownership transfer")
	ErrAccountDeletionToken   = errors.New("account deletion status token is invalid")
)

type AccountDeletionBlocker struct {
	SpaceID     string `json:"space_id"`
	Name        string `json:"name"`
	MemberCount int    `json:"member_count"`
}

type AccountDeletionRequest struct {
	ID                       string            `json:"id"`
	UserID                   string            `json:"-"`
	Status                   string            `json:"status"`
	PurgeAfter               time.Time         `json:"purge_after"`
	ProviderRevocationStatus map[string]string `json:"provider_revocation_status"`
	LastErrorCode            string            `json:"last_error_code,omitempty"`
	CreatedAt                time.Time         `json:"created_at"`
	UpdatedAt                time.Time         `json:"updated_at"`
	CompletedAt              *time.Time        `json:"completed_at,omitempty"`
}

func (db *Database) AccountDeletionBlockers(
	ctx context.Context, userID string,
) ([]AccountDeletionBlocker, error) {
	out := []AccountDeletionBlocker{}
	err := db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `
			SELECT s.id,s.name,COUNT(m.user_id)
			FROM spaces s
			LEFT JOIN space_members m ON m.space_id=s.id
			WHERE s.owner_user_id=$1 AND s.lifecycle_state='active'
			GROUP BY s.id,s.name
			ORDER BY s.created_at`, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item AccountDeletionBlocker
			if err := rows.Scan(&item.SpaceID, &item.Name, &item.MemberCount); err != nil {
				return err
			}
			out = append(out, item)
		}
		return rows.Err()
	})
	return out, err
}

func (db *Database) BeginAccountDeletion(
	ctx context.Context, userID, requestID, statusTokenHash string, retention time.Duration,
) (*AccountDeletionRequest, error) {
	if userID == "" || requestID == "" || statusTokenHash == "" {
		return nil, ErrAccountDeletionToken
	}
	if retention < 24*time.Hour {
		retention = 30 * 24 * time.Hour
	}
	purgeAfter := time.Now().UTC().Add(retention)
	out := &AccountDeletionRequest{}
	err := db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		var state string
		if err := tx.QueryRowContext(
			ctx, `SELECT lifecycle_state FROM users WHERE id=$1 FOR UPDATE`, userID,
		).Scan(&state); err != nil {
			return err
		}
		if state != "active" {
			return ErrAccountDeletionBlocked
		}
		var owned int
		if err := tx.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM spaces
			WHERE owner_user_id=$1 AND lifecycle_state='active'`, userID,
		).Scan(&owned); err != nil {
			return err
		}
		if owned > 0 {
			return ErrAccountDeletionBlocked
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO account_deletion_requests(
			    id,user_id,status_token_hash,purge_after
			) VALUES($1,$2,$3,$4)`,
			requestID, userID, statusTokenHash, purgeAfter,
		); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE users SET lifecycle_state='pending_deletion',
			    deletion_requested_at=NOW()
			WHERE id=$1`, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id=$1`, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE space_agents SET schedules_enabled=FALSE
			WHERE creator_user_id=$1`, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE space_workflows SET schedules_enabled=FALSE
			WHERE creator_user_id=$1`, userID); err != nil {
			return err
		}
		return scanAccountDeletionRequest(tx.QueryRowContext(ctx, `
			SELECT id,user_id,status,purge_after,provider_revocation_status,
			       last_error_code,created_at,updated_at,completed_at
			FROM account_deletion_requests WHERE id=$1`, requestID), out)
	})
	return out, err
}

func (db *Database) AccountDeletionStatus(
	ctx context.Context, requestID, statusTokenHash string,
) (*AccountDeletionRequest, error) {
	out := &AccountDeletionRequest{}
	err := db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		return scanAccountDeletionRequest(tx.QueryRowContext(ctx, `
			SELECT id,user_id,status,purge_after,provider_revocation_status,
			       last_error_code,created_at,updated_at,completed_at
			FROM account_deletion_requests
			WHERE id=$1 AND status_token_hash=$2`, requestID, statusTokenHash), out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrAccountDeletionToken
	}
	return out, err
}

func (db *Database) AccountDeletionConnections(
	ctx context.Context, userID string,
) ([]CloudConnection, error) {
	out := []CloudConnection{}
	err := db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `
			SELECT id,user_id,provider,name,account_id,account_display,
			       credential_ciphertext,credential_nonce,key_version,
			       uses_custom_oauth_client,expires_at,created_at,updated_at
			FROM cloud_connections
			WHERE user_id=$1 AND revoked_at IS NULL`, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item CloudConnection
			if err := rows.Scan(
				&item.ID, &item.UserID, &item.Provider, &item.Name,
				&item.AccountID, &item.AccountDisplay,
				&item.CredentialCiphertext, &item.CredentialNonce,
				&item.KeyVersion, &item.UsesCustomOAuthClient,
				&item.ExpiresAt, &item.CreatedAt, &item.UpdatedAt,
			); err != nil {
				return err
			}
			out = append(out, item)
		}
		return rows.Err()
	})
	return out, err
}

func (db *Database) AccountDeletionProviderCredentials(
	ctx context.Context, userID string,
) ([]ProviderCredential, error) {
	out := []ProviderCredential{}
	err := db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `
			SELECT id,integration_id,space_id,user_id,provider,ciphertext,nonce,
			       key_version,account_id,account_display,expires_at
			FROM space_provider_credentials
			WHERE user_id=$1 AND revoked_at IS NULL`, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item ProviderCredential
			if err := rows.Scan(
				&item.ID, &item.IntegrationID, &item.SpaceID, &item.UserID,
				&item.Provider, &item.Ciphertext, &item.Nonce,
				&item.KeyVersion, &item.AccountID, &item.AccountDisplay,
				&item.ExpiresAt,
			); err != nil {
				return err
			}
			out = append(out, item)
		}
		return rows.Err()
	})
	return out, err
}

func (db *Database) ProcessingAccountDeletions(
	ctx context.Context, limit int,
) ([]AccountDeletionRequest, error) {
	if limit < 1 || limit > 100 {
		limit = 25
	}
	out := []AccountDeletionRequest{}
	err := db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `
			SELECT id,user_id,status,purge_after,provider_revocation_status,
			       last_error_code,created_at,updated_at,completed_at
			FROM account_deletion_requests
			WHERE status='processing'
			ORDER BY updated_at
			LIMIT $1`, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item AccountDeletionRequest
			if err := scanAccountDeletionRequest(rows, &item); err != nil {
				return err
			}
			out = append(out, item)
		}
		return rows.Err()
	})
	return out, err
}

func (db *Database) RecordAccountDeletionFailure(
	ctx context.Context, requestID, code string,
) error {
	if strings.TrimSpace(code) == "" {
		code = "cleanup_failed"
	}
	return db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			UPDATE account_deletion_requests
			SET last_error_code=$1,updated_at=NOW()
			WHERE id=$2 AND status='processing'`, code, requestID)
		return err
	})
}

func (db *Database) ScheduleAccountDeletion(
	ctx context.Context, requestID string, providerStatus map[string]string,
) error {
	raw, err := json.Marshal(providerStatus)
	if err != nil {
		return err
	}
	return db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		var userID string
		if err := tx.QueryRowContext(ctx, `
			SELECT user_id FROM account_deletion_requests
			WHERE id=$1 AND status='processing' FOR UPDATE`,
			requestID,
		).Scan(&userID); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `
			SELECT space_id FROM space_members
			WHERE user_id=$1 AND role='member'`, userID)
		if err != nil {
			return err
		}
		spaceIDs := []string{}
		for rows.Next() {
			var spaceID string
			if err := rows.Scan(&spaceID); err != nil {
				rows.Close()
				return err
			}
			spaceIDs = append(spaceIDs, spaceID)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, spaceID := range spaceIDs {
			if _, err := tx.ExecContext(ctx, `
				DELETE FROM space_conversation_members cm
				USING space_conversations c
				WHERE cm.conversation_id=c.id AND c.space_id=$1
				  AND cm.user_id=$2`, spaceID, userID); err != nil {
				return err
			}
			if err := handleNoteMembershipLossTx(ctx, tx, spaceID, userID); err != nil {
				return err
			}
			if err := revokeDrawingAccessForSpaceTx(ctx, tx, spaceID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `
				DELETE FROM space_members WHERE space_id=$1 AND user_id=$2`,
				spaceID, userID,
			); err != nil {
				return err
			}
			if err := notifySpaceControlTx(ctx, tx, map[string]any{
				"type": "member.left", "space_id": spaceID,
				"user_ids": []string{userID},
			}); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE cloud_connections
			SET revoked_at=NOW(),credential_ciphertext=''::bytea,
			    credential_nonce=''::bytea,updated_at=NOW()
			WHERE user_id=$1`, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM cloud_oauth_states WHERE user_id=$1`, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE space_integrations
			SET status='needs_attention',credential_reference='account_deleted',
			    updated_at=NOW()
			WHERE connected_by_user_id=$1`, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE space_provider_credentials
			SET revoked_at=NOW(),ciphertext=''::bytea,nonce=''::bytea,
			    updated_at=NOW()
			WHERE user_id=$1`, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM provider_oauth_states WHERE user_id=$1`, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE provider_subscriptions
			SET status='disabled',updated_at=NOW()
			WHERE user_id=$1`, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM provider_event_inbox WHERE user_id=$1`, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE workflow_device_node_jobs
			SET state='canceled',completed_at=NOW()
			WHERE user_id=$1 AND state IN ('queued','leased')`, userID); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE account_deletion_requests
			SET status='scheduled',provider_revocation_status=$1,
			    updated_at=NOW(),last_error_code=''
			WHERE id=$2`, raw, requestID)
		return err
	})
}

func (db *Database) DueAccountDeletions(
	ctx context.Context, limit int,
) ([]AccountDeletionRequest, error) {
	if limit < 1 || limit > 100 {
		limit = 25
	}
	out := []AccountDeletionRequest{}
	err := db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `
			SELECT id,user_id,status,purge_after,provider_revocation_status,
			       last_error_code,created_at,updated_at,completed_at
			FROM account_deletion_requests
			WHERE status='scheduled' AND purge_after<=NOW()
			ORDER BY purge_after FOR UPDATE SKIP LOCKED LIMIT $1`, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item AccountDeletionRequest
			if err := scanAccountDeletionRequest(rows, &item); err != nil {
				return err
			}
			out = append(out, item)
		}
		return rows.Err()
	})
	return out, err
}

func (db *Database) CompleteAccountDeletion(
	ctx context.Context, requestID string,
) error {
	return db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		var userID string
		if err := tx.QueryRowContext(ctx, `
			SELECT user_id FROM account_deletion_requests
			WHERE id=$1 AND status='scheduled' AND purge_after<=NOW()
			FOR UPDATE`, requestID,
		).Scan(&userID); err != nil {
			return err
		}
		suffix := strings.ReplaceAll(userID, "-", "")
		if len(suffix) > 16 {
			suffix = suffix[:16]
		}
		password, err := bcrypt.GenerateFromPassword(
			[]byte(uuid.NewString()+uuid.NewString()), bcrypt.DefaultCost,
		)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id=$1`, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE users
			SET name='Deleted user',username=$1,email=$2,password_hash=$3,
			    email_updates_enabled=FALSE,analytics_enabled=FALSE,
			    error_reporting_enabled=FALSE,avatar_version=0,
			    lifecycle_state='deleted',anonymized_at=NOW()
			WHERE id=$4 AND lifecycle_state='pending_deletion'`,
			"deleted_"+suffix, "deleted+"+suffix+"@misty.invalid",
			string(password), userID,
		); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE account_deletion_requests
			SET status='completed',completed_at=NOW(),updated_at=NOW()
			WHERE id=$1`, requestID)
		return err
	})
}

func scanAccountDeletionRequest(
	scanner interface{ Scan(...any) error }, out *AccountDeletionRequest,
) error {
	var providerStatus []byte
	if err := scanner.Scan(
		&out.ID, &out.UserID, &out.Status, &out.PurgeAfter,
		&providerStatus, &out.LastErrorCode, &out.CreatedAt,
		&out.UpdatedAt, &out.CompletedAt,
	); err != nil {
		return err
	}
	out.ProviderRevocationStatus = map[string]string{}
	return json.Unmarshal(providerStatus, &out.ProviderRevocationStatus)
}
