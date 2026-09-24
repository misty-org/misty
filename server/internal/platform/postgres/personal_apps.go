package db

import (
	"context"
	"database/sql"
	"strings"
)

// PersonalAppScopes deliberately excludes shared content. A personal installation
// does not delegate a member's Space permissions to downloaded code.
func PersonalAppScopes(scopes []string) []string {
	result := []string{}
	for _, scope := range scopes {
		switch strings.SplitN(scope, ".", 2)[0] {
		case "spaces", "messages", "notes", "drawings", "tasks", "calendar", "roadmaps", "library", "activity":
			continue
		}
		result = append(result, scope)
	}
	return result
}
func requireUserAppTx(ctx context.Context, tx *sql.Tx, userID, appID string) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM user_app_installations WHERE user_id=$1 AND app_id=$2 AND state='installed' AND NOT consent_required)`, userID, appID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrAppNotInstalled
	}
	return nil
}
func (db *Database) ReorderUserApps(ctx context.Context, userID string, ids []string) error {
	if AppAuthorityFromContext(ctx) != nil {
		return ErrAppRuntimeForbidden
	}
	return db.TestingWithRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "apps:order:"+userID); err != nil {
			return err
		}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_app_installations WHERE user_id=$1 AND state='installed'`, userID).Scan(&count); err != nil {
			return err
		}
		if count != len(ids) {
			return ErrSpaceConflict
		}
		seen := map[string]bool{}
		for i, id := range ids {
			if seen[id] {
				return ErrSpaceInvalid
			}
			seen[id] = true
			result, err := tx.ExecContext(ctx, `UPDATE user_app_installations SET pin_rank=$3,updated_at=NOW() WHERE user_id=$1 AND app_id=$2 AND state='installed'`, userID, id, (i+1)*1024)
			if err != nil {
				return err
			}
			n, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if n != 1 {
				return ErrSpaceConflict
			}
		}
		return nil
	})
}

func revokeUserAppRuntimeTx(ctx context.Context, tx *sql.Tx, userID, appID string) error {
	for _, query := range []string{
		`DELETE FROM app_runtime_sessions WHERE user_id=$1 AND app_id=$2`,
		`UPDATE sdk_provider_registrations SET enabled=FALSE WHERE user_id=$1 AND app_id=$2`,
		`UPDATE sdk_targets t SET enabled=FALSE FROM sdk_target_versions v WHERE v.user_id=t.user_id AND v.id=t.id AND v.revision=t.revision AND t.user_id=$1 AND v.target->>'appId'=$2`,
		`UPDATE sdk_capability_invocations c SET cancel_requested_at=COALESCE(c.cancel_requested_at,NOW()) WHERE c.user_id=$1 AND (c.caller_app_id=$2 OR EXISTS(SELECT 1 FROM sdk_target_versions v WHERE v.user_id=c.user_id AND v.id=c.target_id AND v.revision=c.target_revision AND v.target->>'appId'=$2))`,
	} {
		if _, err := tx.ExecContext(ctx, query, userID, appID); err != nil {
			return err
		}
	}
	return nil
}
