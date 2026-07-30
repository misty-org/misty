package db

import (
	"context"
	"database/sql"
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
	ID                  string                    `json:"id"`
	SpaceID             string                    `json:"space_id"`
	Title               string                    `json:"title"`
	CreatedByUserID     string                    `json:"created_by_user_id"`
	Origin              string                    `json:"origin"`
	IntegrationID       string                    `json:"integration_id,omitempty"`
	ExternalResourceID  string                    `json:"external_resource_id,omitempty"`
	ExternalDisplayName string                    `json:"external_display_name,omitempty"`
	IntegrationStatus   string                    `json:"integration_status"`
	VisibleToSpace      bool                      `json:"visible_to_space"`
	Members             []SpaceConversationMember `json:"members"`
	CreatedAt           time.Time                 `json:"created_at"`
	UpdatedAt           time.Time                 `json:"updated_at"`
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
		JOIN space_members sm ON sm.space_id=c.space_id
		WHERE c.id=$1 AND c.space_id=$2 AND sm.user_id=$3
		  AND (c.visible_to_space OR EXISTS(
		      SELECT 1 FROM space_conversation_members cm
		      WHERE cm.conversation_id=c.id AND cm.user_id=$3
		  ))
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
	query := `SELECT cm.user_id,u.name,u.email,cm.joined_at
		FROM space_conversation_members cm JOIN users u ON u.id=cm.user_id
		WHERE cm.conversation_id=$1 ORDER BY u.name,u.email`
	if conversation.VisibleToSpace {
		query = `SELECT sm.user_id,u.name,u.email,sm.joined_at
			FROM space_members sm JOIN users u ON u.id=sm.user_id
			WHERE sm.space_id=$1 ORDER BY u.name,u.email`
	}
	argument := conversation.ID
	if conversation.VisibleToSpace {
		argument = conversation.SpaceID
	}
	rows, err := tx.QueryContext(ctx, query, argument)
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
		rows, err := tx.QueryContext(ctx, `SELECT c.id,c.space_id,c.title,c.created_by_user_id,
			c.origin,COALESCE(c.integration_id,''),c.external_resource_id,c.external_display_name,
			c.integration_status,c.visible_to_space,c.created_at,c.updated_at
			FROM space_conversations c
			LEFT JOIN space_conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$2
			WHERE c.space_id=$1 AND (c.visible_to_space OR cm.user_id=$2)
			ORDER BY c.updated_at DESC,c.id`, spaceID, userID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var item SpaceConversation
			if err := rows.Scan(&item.ID, &item.SpaceID, &item.Title, &item.CreatedByUserID,
				&item.Origin, &item.IntegrationID, &item.ExternalResourceID, &item.ExternalDisplayName,
				&item.IntegrationStatus, &item.VisibleToSpace, &item.CreatedAt, &item.UpdatedAt); err != nil {
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
	if len(members) < 2 {
		return nil, ErrSpaceInvalid
	}
	out := &SpaceConversation{
		ID: "space_conversation_" + uuid.NewString(), SpaceID: spaceID, Title: title,
		CreatedByUserID: userID, Origin: "misty", IntegrationStatus: "active",
	}
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
			VALUES($1,$2,$3,$4) RETURNING created_at,updated_at`, out.ID, spaceID, title, userID).
			Scan(&out.CreatedAt, &out.UpdatedAt); err != nil {
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
