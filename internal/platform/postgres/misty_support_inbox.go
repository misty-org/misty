package db

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
)

type MistySupportInboxItem struct {
	ConversationID   string    `json:"conversation_id"`
	UserID           string    `json:"user_id"`
	Name             string    `json:"name"`
	Username         string    `json:"username"`
	Email            string    `json:"email"`
	AvatarVersion    int64     `json:"avatar_version"`
	LatestPreview    string    `json:"latest_message_preview"`
	LatestMessageSeq int64     `json:"latest_message_seq"`
	ActivityAt       time.Time `json:"activity_at"`
	UnreadCount      int64     `json:"unread_count"`
}

type MistySupportInboxPage struct {
	Items      []MistySupportInboxItem `json:"items"`
	NextCursor string                  `json:"next_cursor,omitempty"`
}

type mistySupportInboxCursor struct {
	Unread   bool      `json:"unread"`
	Activity time.Time `json:"activity"`
	ID       string    `json:"id"`
}

func requireMistyOperatorTx(ctx context.Context, tx *sql.Tx, userID, spaceID string) error {
	var allowed bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM misty_space_config c
		JOIN misty_space_operators o ON o.user_id=$1
		WHERE c.singleton=1 AND c.space_id=$2
	)`, userID, spaceID).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return ErrSpaceForbidden
	}
	return nil
}

func decodeMistySupportInboxCursor(raw string) (*mistySupportInboxCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, ErrSpaceInvalid
	}
	var cursor mistySupportInboxCursor
	if json.Unmarshal(payload, &cursor) != nil || cursor.ID == "" || cursor.Activity.IsZero() {
		return nil, ErrSpaceInvalid
	}
	return &cursor, nil
}

func encodeMistySupportInboxCursor(item MistySupportInboxItem) string {
	payload, _ := json.Marshal(mistySupportInboxCursor{
		Unread: item.UnreadCount > 0, Activity: item.ActivityAt, ID: item.ConversationID,
	})
	return base64.RawURLEncoding.EncodeToString(payload)
}

func (db *Database) MistySupportInbox(ctx context.Context, operatorUserID, spaceID, scope, search, cursorRaw string, limit int) (*MistySupportInboxPage, error) {
	if limit < 1 || limit > 100 {
		limit = 30
	}
	cursor, err := decodeMistySupportInboxCursor(cursorRaw)
	if err != nil {
		return nil, err
	}
	scope = strings.ToLower(strings.TrimSpace(scope))
	if scope != "" && scope != "active" && scope != "all" {
		return nil, ErrSpaceInvalid
	}
	search = "%" + strings.ToLower(strings.TrimSpace(search)) + "%"
	page := &MistySupportInboxPage{Items: []MistySupportInboxItem{}}
	err = db.TestingSpaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireMistyOperatorTx(ctx, tx, operatorUserID, spaceID); err != nil {
			return err
		}
		hasCursor := cursor != nil
		cursorUnread, cursorActivity, cursorID := false, time.Time{}, ""
		if cursor != nil {
			cursorUnread, cursorActivity, cursorID = cursor.Unread, cursor.Activity, cursor.ID
		}
		rows, err := tx.QueryContext(ctx, `WITH support AS (
			SELECT c.id,c.support_user_id,u.name,u.username,u.email,COALESCE(u.avatar_version,0) avatar_version,
				COALESCE(last_message.preview,'') latest_preview,COALESCE(last_message.seq,0) latest_seq,
				COALESCE(last_message.created_at,c.updated_at) activity_at,
				COALESCE((SELECT count(*) FROM space_messages unread
					WHERE unread.conversation_id=c.id AND unread.sender_user_id<>$1
					  AND unread.seq>COALESCE((SELECT r.read_message_seq FROM space_conversation_reads r
						WHERE r.conversation_id=c.id AND r.user_id=$1),0)),0) unread_count
			FROM space_conversations c
			JOIN users u ON u.id=c.support_user_id
			LEFT JOIN LATERAL (
				SELECT m.seq,m.created_at,LEFT(COALESCE((
					SELECT string_agg(COALESCE(span->>'text',''),' ')
					FROM jsonb_array_elements(m.content) span
				),''),240) preview
				FROM space_messages m WHERE m.conversation_id=c.id ORDER BY m.seq DESC LIMIT 1
			) last_message ON TRUE
			WHERE c.space_id=$2 AND c.kind='misty_support'
			  AND ($3 OR last_message.seq IS NOT NULL)
			  AND ($4='%%' OR LOWER(u.name) LIKE $4 OR LOWER(u.username) LIKE $4 OR LOWER(u.email) LIKE $4)
		)
		SELECT id,support_user_id,name,username,email,avatar_version,latest_preview,latest_seq,activity_at,unread_count
		FROM support
		WHERE NOT $5 OR
			((unread_count>0)<$6 OR ((unread_count>0)=$6 AND
			(activity_at<$7 OR (activity_at=$7 AND id>$8))))
		ORDER BY (unread_count>0) DESC,activity_at DESC,id ASC LIMIT $9`,
			operatorUserID, spaceID, scope == "all", search, hasCursor, cursorUnread, cursorActivity, cursorID, limit+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item MistySupportInboxItem
			if err := rows.Scan(&item.ConversationID, &item.UserID, &item.Name, &item.Username, &item.Email,
				&item.AvatarVersion, &item.LatestPreview, &item.LatestMessageSeq, &item.ActivityAt, &item.UnreadCount); err != nil {
				return err
			}
			page.Items = append(page.Items, item)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		page.NextCursor = encodeMistySupportInboxCursor(page.Items[limit-1])
	}
	return page, nil
}

func (db *Database) MarkSpaceConversationRead(ctx context.Context, userID, spaceID, conversationID string, seq int64) error {
	if seq < 0 {
		return ErrSpaceInvalid
	}
	return db.TestingSpaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpaceConversationMemberTx(ctx, tx, userID, spaceID, conversationID); err != nil {
			return err
		}
		var maximum int64
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(seq),0) FROM space_messages WHERE conversation_id=$1`, conversationID).Scan(&maximum); err != nil {
			return err
		}
		if seq == 0 || seq > maximum {
			seq = maximum
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO space_conversation_reads(conversation_id,user_id,read_message_seq)
			VALUES($1,$2,$3) ON CONFLICT(conversation_id,user_id) DO UPDATE
			SET read_message_seq=GREATEST(space_conversation_reads.read_message_seq,excluded.read_message_seq),updated_at=NOW()`, conversationID, userID, seq)
		return err
	})
}
