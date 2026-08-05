package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

const (
	MistySpaceID             = "space_misty_canonical"
	MistySecurityDomainID    = "sd_misty_canonical"
	MistyEveryoneRoleID      = "role_misty_canonical"
	MistyOperatorUsername    = "mattdev727"
	MistySupportStorageBytes = int64(50_000_000_000)
)

// BootstrapMistySpace validates the configured immutable operator identity and
// reconciles the singleton Space. It is intentionally idempotent so every API
// process may run it during startup.
func (db *Database) BootstrapMistySpace(ctx context.Context, operatorUserID string) error {
	operatorUserID = strings.TrimSpace(operatorUserID)
	if operatorUserID == "" {
		return errors.New("MISTY_OPERATOR_USER_ID is required")
	}

	return db.TestingSpaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('misty-space:bootstrap'))`); err != nil {
			return err
		}

		var username, lifecycleState string
		if err := tx.QueryRowContext(ctx, `SELECT username,lifecycle_state FROM users WHERE id=$1`, operatorUserID).Scan(&username, &lifecycleState); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("configured Misty operator %q does not exist", operatorUserID)
			}
			return err
		}
		if lifecycleState != "active" {
			return fmt.Errorf("configured Misty operator %q is not active", operatorUserID)
		}
		if !strings.EqualFold(username, MistyOperatorUsername) {
			return fmt.Errorf("configured Misty operator %q belongs to @%s, expected @%s", operatorUserID, username, MistyOperatorUsername)
		}

		if _, err := tx.ExecContext(ctx, `SET CONSTRAINTS ALL DEFERRED`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO security_domains(id,kind,owner_user_id,space_id)
			VALUES($1,'space',$2,$3) ON CONFLICT(id) DO NOTHING`, MistySecurityDomainID, operatorUserID, MistySpaceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO spaces(id,owner_user_id,name,security_domain_id,kind)
			VALUES($1,$2,'Misty',$3,'misty') ON CONFLICT(id) DO NOTHING`, MistySpaceID, operatorUserID, MistySecurityDomainID); err != nil {
			return err
		}

		var actualOwner, actualKind string
		if err := tx.QueryRowContext(ctx, `SELECT owner_user_id,kind FROM spaces WHERE id=$1 FOR UPDATE`, MistySpaceID).Scan(&actualOwner, &actualKind); err != nil {
			return err
		}
		if actualOwner != operatorUserID || actualKind != "misty" {
			return fmt.Errorf("canonical Misty Space conflicts with configured operator")
		}

		statements := []struct {
			query string
			args  []any
		}{
			{`INSERT INTO space_storage_usage(space_id) VALUES($1) ON CONFLICT DO NOTHING`, []any{MistySpaceID}},
			{`INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,'owner')
			 ON CONFLICT(space_id,user_id) DO UPDATE SET role='owner'`, []any{MistySpaceID, operatorUserID}},
			{`INSERT INTO space_roles(id,space_id,name,is_everyone,permissions)
			 VALUES($1,$2,'@everyone',TRUE,'["space.view","messages.read","tasks.view"]'::jsonb)
			 ON CONFLICT(id) DO NOTHING`, []any{MistyEveryoneRoleID, MistySpaceID}},
			{`INSERT INTO misty_space_config(singleton,space_id,support_storage_limit_bytes)
			 VALUES(1,$1,$2) ON CONFLICT(singleton) DO UPDATE
			 SET space_id=excluded.space_id,support_storage_limit_bytes=excluded.support_storage_limit_bytes,updated_at=NOW()`, []any{MistySpaceID, MistySupportStorageBytes}},
			{`INSERT INTO misty_space_operators(user_id) VALUES($1) ON CONFLICT DO NOTHING`, []any{operatorUserID}},
			{`INSERT INTO misty_support_storage_usage(singleton) VALUES(1) ON CONFLICT DO NOTHING`, nil},
			{`INSERT INTO space_conversation_members(conversation_id,user_id)
			 SELECT id,$1 FROM space_conversations WHERE kind='misty_support'
			 ON CONFLICT DO NOTHING`, []any{operatorUserID}},
			{`SELECT misty_ensure_default_space(id) FROM users WHERE lifecycle_state='active'`, nil},
		}
		for _, statement := range statements {
			if _, err := tx.ExecContext(ctx, statement.query, statement.args...); err != nil {
				return err
			}
		}
		return nil
	})
}

func adjustMistySupportStorageTx(ctx context.Context, tx *sql.Tx, spaceID string, usedDelta, reservedDelta int64) error {
	result, err := tx.ExecContext(ctx, `UPDATE misty_support_storage_usage u
		SET used_bytes=GREATEST(0,u.used_bytes+$2),reserved_bytes=GREATEST(0,u.reserved_bytes+$3),version=u.version+1,updated_at=NOW()
		FROM misty_space_config c WHERE u.singleton=1 AND c.singleton=1 AND c.space_id=$1`, spaceID, usedDelta, reservedDelta)
	if err != nil {
		return err
	}
	_, err = result.RowsAffected()
	return err
}

func reconcileMistySupportStorageTx(ctx context.Context, tx *sql.Tx, spaceID string) error {
	_, err := tx.ExecContext(ctx, `UPDATE misty_support_storage_usage u
		SET used_bytes=COALESCE((SELECT SUM(sc.logical_bytes) FROM space_storage_contributions sc
			WHERE sc.space_id=$1 AND sc.state IN ('active','recovery')),0),
			reserved_bytes=COALESCE((SELECT SUM(r.reserved_bytes) FROM space_upload_reservations r
				WHERE r.space_id=$1 AND r.state='active'),0),
			version=u.version+1,updated_at=NOW()
		FROM misty_space_config c WHERE u.singleton=1 AND c.singleton=1 AND c.space_id=$1`, spaceID)
	return err
}

// AssignMistyOperator is the future-compatible operator handoff primitive.
// The current operator must explicitly add an active replacement before their
// own account can enter deletion.
func (db *Database) AssignMistyOperator(ctx context.Context, actorUserID, replacementUserID string) error {
	if strings.TrimSpace(replacementUserID) == "" || actorUserID == replacementUserID {
		return ErrSpaceInvalid
	}
	return db.TestingSpaceTx(ctx, func(tx *sql.Tx) error {
		var spaceID string
		if err := tx.QueryRowContext(ctx, `SELECT c.space_id FROM misty_space_config c
			JOIN misty_space_operators o ON o.user_id=$1 WHERE c.singleton=1`, actorUserID).Scan(&spaceID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrSpaceForbidden
			}
			return err
		}
		var active bool
		if err := tx.QueryRowContext(ctx, `SELECT lifecycle_state='active' FROM users WHERE id=$1`, replacementUserID).Scan(&active); err != nil || !active {
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			return ErrSpaceInvalid
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO misty_space_operators(user_id) VALUES($1) ON CONFLICT DO NOTHING`, replacementUserID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING`, spaceID, replacementUserID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_conversation_members(conversation_id,user_id)
			SELECT id,$1 FROM space_conversations WHERE space_id=$2 AND kind='misty_support' ON CONFLICT DO NOTHING`, replacementUserID, spaceID); err != nil {
			return err
		}
		// Operators never retain an end-user support conversation of their own.
		var conversationID sql.NullString
		if err := tx.QueryRowContext(ctx, `SELECT id FROM space_conversations WHERE kind='misty_support' AND support_user_id=$1 FOR UPDATE`, replacementUserID).Scan(&conversationID); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if conversationID.Valid {
			messageIDs, err := messageIDsForConversationTx(ctx, tx, spaceID, conversationID.String)
			if err != nil {
				return err
			}
			if err := cleanupSpaceMessagesTx(ctx, tx, spaceID, messageIDs); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM space_conversations WHERE id=$1`, conversationID.String); err != nil {
				return err
			}
		}
		return nil
	})
}
