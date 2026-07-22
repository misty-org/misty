package db

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

type SpaceConversationMember struct {
	UserID   string    `json:"user_id"`
	Name     string    `json:"name"`
	Email    string    `json:"email"`
	JoinedAt time.Time `json:"joined_at"`
}

type SpaceConversation struct {
	ID              string                    `json:"id"`
	SpaceID         string                    `json:"space_id"`
	Title           string                    `json:"title"`
	CreatedByUserID string                    `json:"created_by_user_id"`
	Members         []SpaceConversationMember `json:"members"`
	CreatedAt       time.Time                 `json:"created_at"`
	UpdatedAt       time.Time                 `json:"updated_at"`
}

func normalizeConversationTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > 80 {
		return "", ErrSpaceInvalid
	}
	return title, nil
}

func requireSpaceConversationMemberTx(ctx context.Context, tx *sql.Tx, userID, spaceID, conversationID string) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM space_conversations c
		JOIN space_conversation_members cm ON cm.conversation_id=c.id
		JOIN space_members sm ON sm.space_id=c.space_id AND sm.user_id=cm.user_id
		WHERE c.id=$1 AND c.space_id=$2 AND cm.user_id=$3
	)`, conversationID, spaceID, userID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrSpaceForbidden
	}
	return nil
}

func loadSpaceConversationMembersTx(ctx context.Context, tx *sql.Tx, conversation *SpaceConversation) error {
	conversation.Members = []SpaceConversationMember{}
	rows, err := tx.QueryContext(ctx, `SELECT cm.user_id,u.name,u.email,cm.joined_at
		FROM space_conversation_members cm JOIN users u ON u.id=cm.user_id
		WHERE cm.conversation_id=$1 ORDER BY u.name,u.email`, conversation.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var member SpaceConversationMember
		if err := rows.Scan(&member.UserID, &member.Name, &member.Email, &member.JoinedAt); err != nil {
			return err
		}
		conversation.Members = append(conversation.Members, member)
	}
	return rows.Err()
}

func (db *Database) SpaceConversations(ctx context.Context, userID, spaceID string) ([]SpaceConversation, error) {
	items := []SpaceConversation{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT c.id,c.space_id,c.title,c.created_by_user_id,c.created_at,c.updated_at
			FROM space_conversations c JOIN space_conversation_members cm ON cm.conversation_id=c.id
			WHERE c.space_id=$1 AND cm.user_id=$2 ORDER BY c.updated_at DESC,c.id`, spaceID, userID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var item SpaceConversation
			if err := rows.Scan(&item.ID, &item.SpaceID, &item.Title, &item.CreatedByUserID, &item.CreatedAt, &item.UpdatedAt); err != nil {
				rows.Close()
				return err
			}
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for index := range items {
			if err := loadSpaceConversationMembersTx(ctx, tx, &items[index]); err != nil {
				return err
			}
		}
		return nil
	})
	return items, err
}

// IsSpaceConversationForMember distinguishes a selected-member group
// conversation from the message correlation ID used by the Space-wide chat.
// If the ID belongs to a selected group, the caller must still be a member;
// otherwise returning false here could accidentally redirect a private reply
// into the Space-wide conversation.
func (db *Database) IsSpaceConversationForMember(ctx context.Context, userID, spaceID, conversationID string) (bool, error) {
	if strings.TrimSpace(conversationID) == "" {
		return false, nil
	}
	selectedGroup := false
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesWrite); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(
			SELECT 1 FROM space_conversations WHERE id=$1 AND space_id=$2
		)`, conversationID, spaceID).Scan(&selectedGroup); err != nil {
			return err
		}
		if !selectedGroup {
			return nil
		}
		return requireSpaceConversationMemberTx(ctx, tx, userID, spaceID, conversationID)
	})
	return selectedGroup, err
}

func (db *Database) CreateSpaceConversation(ctx context.Context, userID, spaceID, title string, memberIDs []string) (*SpaceConversation, error) {
	title, err := normalizeConversationTitle(title)
	if err != nil {
		return nil, err
	}
	members := uniqueSpaceIDs(append(memberIDs, userID))
	if len(members) < 2 || len(members) > MaxSpacePeople {
		return nil, ErrSpaceInvalid
	}
	out := &SpaceConversation{ID: "space_conversation_" + uuid.NewString(), SpaceID: spaceID, Title: title, CreatedByUserID: userID}
	err = db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceMessageWriteTx(ctx, tx, userID, spaceID); err != nil {
			return err
		}
		var validCount int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM space_members WHERE space_id=$1 AND user_id=ANY($2::text[])`, spaceID, pqStringArray(members)).Scan(&validCount); err != nil {
			return err
		}
		if validCount != len(members) {
			return ErrSpaceInvalid
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_conversations(id,space_id,title,created_by_user_id)
			VALUES($1,$2,$3,$4) RETURNING created_at,updated_at`, out.ID, spaceID, title, userID).Scan(&out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		for _, memberID := range members {
			if _, err := tx.ExecContext(ctx, `INSERT INTO space_conversation_members(conversation_id,user_id) VALUES($1,$2)`, out.ID, memberID); err != nil {
				return err
			}
		}
		if _, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "conversation.created", out.ID, map[string]any{"conversation_id": out.ID, "title": title, "member_ids": members}); err != nil {
			return err
		}
		return loadSpaceConversationMembersTx(ctx, tx, out)
	})
	return out, err
}

// UpdateSpaceConversation renames a conversation and/or changes its member
// list. Only the conversation's creator may do this — the same restriction
// the space_conversations_creator_write / space_conversation_members_creator_write
// RLS policies enforce at the database layer for non-superuser roles. This
// checks explicitly too so the behavior is identical (a clear
// ErrSpaceForbidden, not a silently-ignored zero-row update) regardless of
// which role is connected, including in tests that run as a superuser and
// would otherwise bypass RLS entirely.
func (db *Database) UpdateSpaceConversation(ctx context.Context, userID, spaceID, conversationID, title string, memberIDs []string) (*SpaceConversation, error) {
	title, err := normalizeConversationTitle(title)
	if err != nil {
		return nil, err
	}
	members := uniqueSpaceIDs(append(memberIDs, userID))
	if len(members) < 2 || len(members) > MaxSpacePeople {
		return nil, ErrSpaceInvalid
	}
	out := &SpaceConversation{ID: conversationID, SpaceID: spaceID, Title: title}
	err = db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceMessageWriteTx(ctx, tx, userID, spaceID); err != nil {
			return err
		}
		var createdByUserID string
		if err := tx.QueryRowContext(ctx,
			`SELECT created_by_user_id FROM space_conversations WHERE id=$1 AND space_id=$2 FOR UPDATE`,
			conversationID, spaceID,
		).Scan(&createdByUserID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrSpaceNotFound
			}
			return err
		}
		if createdByUserID != userID {
			return ErrSpaceForbidden
		}
		out.CreatedByUserID = createdByUserID
		var validCount int
		if err := tx.QueryRowContext(ctx,
			`SELECT count(*) FROM space_members WHERE space_id=$1 AND user_id=ANY($2::text[])`,
			spaceID, pqStringArray(members),
		).Scan(&validCount); err != nil {
			return err
		}
		if validCount != len(members) {
			return ErrSpaceInvalid
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE space_conversations SET title=$1, updated_at=NOW() WHERE id=$2 AND space_id=$3`,
			title, conversationID, spaceID,
		); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM space_conversation_members WHERE conversation_id=$1 AND user_id<>ALL($2::text[])`,
			conversationID, pqStringArray(members),
		); err != nil {
			return err
		}
		for _, memberID := range members {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO space_conversation_members(conversation_id,user_id) VALUES($1,$2)
					ON CONFLICT (conversation_id,user_id) DO NOTHING`,
				conversationID, memberID,
			); err != nil {
				return err
			}
		}
		if err := tx.QueryRowContext(ctx,
			`SELECT created_at, updated_at FROM space_conversations WHERE id=$1`, conversationID,
		).Scan(&out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		if _, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "conversation.updated", conversationID,
			map[string]any{"conversation_id": conversationID, "title": title, "member_ids": members},
		); err != nil {
			return err
		}
		return loadSpaceConversationMembersTx(ctx, tx, out)
	})
	return out, err
}

func (db *Database) SpaceConversationMessages(ctx context.Context, userID, spaceID, conversationID string, before int64, limit int) ([]SpaceMessage, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	items := []SpaceMessage{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead); err != nil {
			return err
		}
		if err := requireSpaceConversationMemberTx(ctx, tx, userID, spaceID, conversationID); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT `+spaceMessageColumns+` FROM space_messages m
			LEFT JOIN users u ON u.id=m.sender_user_id LEFT JOIN space_agents a ON a.id=m.sender_agent_id
			WHERE m.space_id=$1 AND m.conversation_id=$2 AND ($3=0 OR m.seq<$3) ORDER BY m.seq DESC LIMIT $4`, spaceID, conversationID, before, limit)
		if err != nil {
			return err
		}
		for rows.Next() {
			var item SpaceMessage
			if err := scanSpaceMessage(rows, &item); err != nil {
				rows.Close()
				return err
			}
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for index := range items {
			if err := loadSpaceMessageReferencesTx(ctx, tx, &items[index]); err != nil {
				return err
			}
		}
		return nil
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return items, err
}
