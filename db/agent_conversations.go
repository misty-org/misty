package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	serveragent "github.com/kannachi323/misty/server/agent"
)

var _ serveragent.SessionPersistence = (*Database)(nil)

// CreateAgentSession implements agent.SessionPersistence. Conversation state
// is sanitized by the agent package before it crosses this boundary.
func (db *Database) CreateAgentSession(ctx context.Context, conversationID, userID string, state json.RawMessage, activeUntil, retentionExpiresAt time.Time) error {
	return db.withRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO agent_conversations(id, user_id, state, active_until, retention_expires_at)
			VALUES($1, $2, $3, $4, $5)
			ON CONFLICT(id) DO NOTHING
		`, conversationID, userID, state, activeUntil, retentionExpiresAt)
		return err
	})
}

// LoadAgentSession returns only active, owned sessions. RLS and the explicit
// user predicate ensure callers cannot probe another account's conversation.
func (db *Database) LoadAgentSession(ctx context.Context, conversationID, userID string) (json.RawMessage, error) {
	var state json.RawMessage
	err := db.withRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `
			SELECT state
			FROM agent_conversations
			WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND active_until > NOW()
		`, conversationID, userID).Scan(&state)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, serveragent.ErrPersistedSessionNotFound
	}
	return state, err
}

// SaveAgentSession atomically updates the resumable state and appends its
// durable event records. A failed transaction leaves neither half committed.
func (db *Database) SaveAgentSession(ctx context.Context, conversationID, userID string, state json.RawMessage, events []serveragent.PersistedConversationEvent, activeUntil, retentionExpiresAt time.Time) error {
	return db.withRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `
			UPDATE agent_conversations
			SET state = $1, active_until = $2, retention_expires_at = $3, updated_at = NOW()
			WHERE id = $4 AND user_id = $5 AND deleted_at IS NULL
		`, state, activeUntil, retentionExpiresAt, conversationID, userID)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return serveragent.ErrPersistedSessionNotFound
		}
		for _, event := range events {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO agent_conversation_events(conversation_id, user_id, event_type, data)
				VALUES($1, $2, $3, $4)
			`, conversationID, userID, event.Type, event.Data); err != nil {
				return err
			}
		}
		return nil
	})
}

// DeleteAgentConversation is the user-facing retention escape hatch. The
// cascade removes event data immediately rather than waiting for the sweeper.
func (db *Database) DeleteAgentConversation(ctx context.Context, userID, conversationID string) error {
	return db.withRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `DELETE FROM agent_conversations WHERE id=$1 AND user_id=$2`, conversationID, userID)
		return err
	})
}

// PurgeExpiredAgentConversations is suitable for a periodic server task. It
// intentionally runs as the service role because expiration spans accounts.
func (db *Database) PurgeExpiredAgentConversations(ctx context.Context) (int64, error) {
	var deleted int64
	err := db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `DELETE FROM agent_conversations WHERE retention_expires_at <= NOW()`)
		if err != nil {
			return err
		}
		deleted, err = result.RowsAffected()
		return err
	})
	return deleted, err
}
