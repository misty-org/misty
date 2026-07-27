package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// SpaceDiscordLink binds one Space conversation to one Discord channel.
//
// No Discord token is stored here beyond the optional webhook secret, which is
// sealed with the same AEAD as every other provider credential. The bot token
// itself stays in the server environment and never reaches a client.
type SpaceDiscordLink struct {
	ID                string     `json:"id"`
	SpaceID           string     `json:"space_id"`
	IntegrationID     string     `json:"integration_id"`
	ConversationID    string     `json:"conversation_id,omitempty"`
	ConnectedByUserID string     `json:"connected_by_user_id"`
	GuildID           string     `json:"guild_id"`
	GuildName         string     `json:"guild_name"`
	ChannelID         string     `json:"channel_id"`
	ChannelName       string     `json:"channel_name"`
	Direction         string     `json:"direction"`
	Status            string     `json:"status"`
	LastMessageID     string     `json:"last_message_id,omitempty"`
	LastSyncedAt      *time.Time `json:"last_synced_at,omitempty"`
	LastErrorCode     string     `json:"last_error_code,omitempty"`
	BotUserID         string     `json:"bot_user_id,omitempty"`
	WebhookID         string     `json:"-"`
	WebhookCiphertext []byte     `json:"-"`
	WebhookNonce      []byte     `json:"-"`
	DisabledAt        *time.Time `json:"disabled_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// MessageOrigin is the provenance stamped on a mirrored message.
type MessageOrigin struct {
	System            string   `json:"system"`
	ExternalID        string   `json:"external_id,omitempty"`
	ExternalChannelID string   `json:"external_channel_id,omitempty"`
	AuthorName        string   `json:"author_name,omitempty"`
	AuthorHandle      string   `json:"author_handle,omitempty"`
	AuthorAvatarURL   string   `json:"author_avatar_url,omitempty"`
	AuthoredAt        string   `json:"authored_at,omitempty"`
	PublishState      string   `json:"publish_state,omitempty"`
	PublishedAt       string   `json:"published_at,omitempty"`
	PublishedExternal string   `json:"published_external_id,omitempty"`
	PublishError      string   `json:"publish_error,omitempty"`
	AttachmentURLs    []string `json:"attachment_urls,omitempty"`
}

const spaceDiscordLinkColumns = `id,space_id,integration_id,COALESCE(conversation_id,''),connected_by_user_id,guild_id,guild_name,channel_id,channel_name,direction,status,last_message_id,last_synced_at,last_error_code,bot_user_id,webhook_id,webhook_token_ciphertext,webhook_token_nonce,disabled_at,created_at,updated_at`

func scanSpaceDiscordLink(scanner interface{ Scan(...any) error }, out *SpaceDiscordLink) error {
	return scanner.Scan(&out.ID, &out.SpaceID, &out.IntegrationID, &out.ConversationID, &out.ConnectedByUserID,
		&out.GuildID, &out.GuildName, &out.ChannelID, &out.ChannelName, &out.Direction, &out.Status,
		&out.LastMessageID, &out.LastSyncedAt, &out.LastErrorCode, &out.BotUserID, &out.WebhookID,
		&out.WebhookCiphertext, &out.WebhookNonce, &out.DisabledAt, &out.CreatedAt, &out.UpdatedAt)
}

// SpaceDiscordLinkFor returns the Space's active link, or nil when none exists.
// A Space with no Discord link is the normal case, not an error.
func (db *Database) SpaceDiscordLinkFor(ctx context.Context, userID, spaceID string) (*SpaceDiscordLink, error) {
	items, err := db.SpaceDiscordLinksFor(ctx, userID, spaceID)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return &items[0], nil
}

func (db *Database) SpaceDiscordLinksFor(ctx context.Context, userID, spaceID string) ([]SpaceDiscordLink, error) {
	items := []SpaceDiscordLink{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT `+spaceDiscordLinkColumns+`
			FROM space_discord_links WHERE space_id=$1 AND disabled_at IS NULL
			ORDER BY guild_name,channel_name,id`, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceDiscordLink
			if err := scanSpaceDiscordLink(rows, &item); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

// SpaceDiscordLinkByID reads a link for a service-side operation such as sync.
func (db *Database) SpaceDiscordLinkByID(ctx context.Context, spaceID, linkID string) (*SpaceDiscordLink, error) {
	out := &SpaceDiscordLink{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		return scanSpaceDiscordLink(tx.QueryRowContext(ctx, `SELECT `+spaceDiscordLinkColumns+`
			FROM space_discord_links WHERE id=$1 AND space_id=$2`, linkID, spaceID), out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	if err != nil {
		return nil, err
	}
	return out, nil
}

// SpaceDiscordLinksForChannel returns every active link watching a channel, so
// the Gateway can fan one Discord message out to each mirroring Space.
func (db *Database) SpaceDiscordLinksForChannel(ctx context.Context, guildID, channelID string) ([]SpaceDiscordLink, error) {
	items := []SpaceDiscordLink{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT `+spaceDiscordLinkColumns+`
			FROM space_discord_links WHERE guild_id=$1 AND channel_id=$2 AND disabled_at IS NULL
			AND direction IN ('two_way','inbound')`, guildID, channelID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceDiscordLink
			if err := scanSpaceDiscordLink(rows, &item); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

// CreateSpaceDiscordLink binds a channel. Requires integrations.manage, because
// creating a link is what authorizes Misty to write into a Discord server.
func (db *Database) CreateSpaceDiscordLink(ctx context.Context, userID string, item SpaceDiscordLink) (*SpaceDiscordLink, error) {
	item.GuildID, item.ChannelID = strings.TrimSpace(item.GuildID), strings.TrimSpace(item.ChannelID)
	if item.GuildID == "" || item.ChannelID == "" {
		return nil, ErrSpaceInvalid
	}
	if item.Direction == "" {
		item.Direction = "two_way"
	}
	if item.Direction != "two_way" && item.Direction != "inbound" && item.Direction != "outbound" {
		return nil, ErrSpaceInvalid
	}
	out := &SpaceDiscordLink{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, item.SpaceID, PermissionIntegrationsManage); err != nil {
			return err
		}
		var connectedByUserID string
		if err := tx.QueryRowContext(ctx, `SELECT connected_by_user_id FROM space_integrations
			WHERE id=$1 AND space_id=$2 AND provider='discord' AND status='active'`,
			item.IntegrationID, item.SpaceID).Scan(&connectedByUserID); err != nil {
			return ErrSpaceInvalid
		}
		if item.ConversationID != "" {
			if err := requireSpaceConversationMemberTx(ctx, tx, userID, item.SpaceID, item.ConversationID); err != nil {
				return err
			}
		}
		conversationID, err := ensureDiscordConversationTx(ctx, tx, userID, item)
		if err != nil {
			return err
		}
		item.ConversationID = conversationID
		return scanSpaceDiscordLink(tx.QueryRowContext(ctx, `INSERT INTO space_discord_links
			(id,space_id,integration_id,conversation_id,connected_by_user_id,guild_id,guild_name,channel_id,channel_name,direction,status,bot_user_id,webhook_id,webhook_token_ciphertext,webhook_token_nonce)
			VALUES($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13,$14)
			ON CONFLICT(space_id,channel_id) DO UPDATE SET
				integration_id=EXCLUDED.integration_id,
				conversation_id=EXCLUDED.conversation_id,
				connected_by_user_id=EXCLUDED.connected_by_user_id,
				guild_id=EXCLUDED.guild_id,
				guild_name=EXCLUDED.guild_name,
				channel_name=EXCLUDED.channel_name,
				direction=EXCLUDED.direction,
				status='pending',
				last_error_code='',
				disabled_at=NULL,
				updated_at=NOW()
			RETURNING `+spaceDiscordLinkColumns,
			"discordlink_"+uuid.NewString(), item.SpaceID, item.IntegrationID, item.ConversationID, connectedByUserID,
			item.GuildID, item.GuildName, item.ChannelID, item.ChannelName, item.Direction,
			item.BotUserID, item.WebhookID, item.WebhookCiphertext, item.WebhookNonce), out)
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func ensureDiscordConversationTx(ctx context.Context, tx *sql.Tx, userID string, item SpaceDiscordLink) (string, error) {
	title := discordConversationTitle(item.ChannelName)
	if item.ConversationID != "" {
		_, err := tx.ExecContext(ctx, `UPDATE space_conversations SET
			title=$1,origin='discord',integration_id=$2,external_resource_id=$3,
			external_display_name=$4,integration_status='active',visible_to_space=TRUE,updated_at=NOW()
			WHERE id=$5 AND space_id=$6`, title, item.IntegrationID, item.ChannelID,
			item.ChannelName, item.ConversationID, item.SpaceID)
		return item.ConversationID, err
	}
	var conversationID string
	err := tx.QueryRowContext(ctx, `SELECT id FROM space_conversations
		WHERE space_id=$1 AND origin='discord' AND external_resource_id=$2
		FOR UPDATE`, item.SpaceID, item.ChannelID).Scan(&conversationID)
	if err == nil {
		_, err = tx.ExecContext(ctx, `UPDATE space_conversations SET title=$1,integration_id=$2,
			external_display_name=$3,integration_status='active',visible_to_space=TRUE,updated_at=NOW()
			WHERE id=$4`, title, item.IntegrationID, item.ChannelName, conversationID)
		return conversationID, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	conversationID = "space_conversation_" + uuid.NewString()
	_, err = tx.ExecContext(ctx, `INSERT INTO space_conversations
		(id,space_id,title,created_by_user_id,origin,integration_id,external_resource_id,
		 external_display_name,integration_status,visible_to_space)
		VALUES($1,$2,$3,$4,'discord',$5,$6,$7,'active',TRUE)`,
		conversationID, item.SpaceID, title, userID, item.IntegrationID, item.ChannelID, item.ChannelName)
	return conversationID, err
}

func discordConversationTitle(displayName string) string {
	title := strings.TrimSpace(displayName)
	if marker := strings.LastIndex(title, "/ #"); marker >= 0 {
		title = title[marker+3:]
	}
	title = strings.TrimPrefix(title, "#")
	runes := []rune(strings.TrimSpace(title))
	if len(runes) > 80 {
		runes = runes[:80]
	}
	if len(runes) == 0 {
		return "Discord"
	}
	return string(runes)
}

// UpdateSpaceDiscordLinkDirection changes the allowed mirror direction without
// discarding the cursor, so pausing a mirror never replays a transcript.
func (db *Database) UpdateSpaceDiscordLinkDirection(ctx context.Context, userID, spaceID, linkID, direction string) (*SpaceDiscordLink, error) {
	if direction != "two_way" && direction != "inbound" && direction != "outbound" {
		return nil, ErrSpaceInvalid
	}
	out := &SpaceDiscordLink{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionIntegrationsManage); err != nil {
			return err
		}
		err := scanSpaceDiscordLink(tx.QueryRowContext(ctx, `UPDATE space_discord_links
			SET direction=$1,updated_at=NOW() WHERE id=$2 AND space_id=$3 AND disabled_at IS NULL
			RETURNING `+spaceDiscordLinkColumns, direction, linkID, spaceID), out)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceNotFound
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// DeleteSpaceDiscordLink unlinks a channel. Already-mirrored messages stay in
// the Space: unlinking stops future mirroring, it does not rewrite history.
func (db *Database) DeleteSpaceDiscordLink(ctx context.Context, userID, spaceID, linkID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionIntegrationsManage); err != nil {
			return err
		}
		var conversationID string
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(conversation_id,'') FROM space_discord_links
			WHERE id=$1 AND space_id=$2`, linkID, spaceID).Scan(&conversationID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrSpaceNotFound
			}
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE space_discord_links
			SET disabled_at=NOW(),status='disabled',updated_at=NOW()
			WHERE id=$1 AND space_id=$2 AND disabled_at IS NULL`, linkID, spaceID)
		if err != nil {
			return err
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			return ErrSpaceNotFound
		}
		if conversationID != "" {
			_, err = tx.ExecContext(ctx, `UPDATE space_conversations
				SET integration_status='disconnected',updated_at=NOW() WHERE id=$1`, conversationID)
		}
		return err
	})
}

// SetSpaceDiscordLinkSync records the outcome of a sync pass. The cursor only
// ever moves forward, so a retry or an out-of-order page cannot replay history.
func (db *Database) SetSpaceDiscordLinkSync(ctx context.Context, linkID, cursor, status, errorCode string, syncedAt *time.Time) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE space_discord_links
			SET last_message_id=CASE WHEN $2<>'' THEN $2 ELSE last_message_id END,
			    status=$3,last_error_code=$4,
			    last_synced_at=COALESCE($5,last_synced_at),updated_at=NOW()
			WHERE id=$1`, linkID, cursor, status, errorCode, syncedAt)
		return err
	})
}

func (db *Database) UpdateSpaceDiscordLinkDisplay(
	ctx context.Context,
	linkID, channelName string,
) error {
	channelName = strings.TrimSpace(channelName)
	if channelName == "" {
		return ErrSpaceInvalid
	}
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		var conversationID string
		if err := tx.QueryRowContext(ctx, `UPDATE space_discord_links
			SET channel_name=$1,updated_at=NOW() WHERE id=$2
			RETURNING COALESCE(conversation_id,'')`, channelName, linkID).Scan(&conversationID); err != nil {
			return err
		}
		if conversationID == "" {
			return nil
		}
		_, err := tx.ExecContext(ctx, `UPDATE space_conversations
			SET title=$1,external_display_name=$2,updated_at=NOW() WHERE id=$3`,
			discordConversationTitle(channelName), channelName, conversationID)
		return err
	})
}

// CreateMirroredSpaceMessage writes an inbound Discord message into a Space.
//
// It is deliberately idempotent on the provider's message id: the Gateway, a
// manual sync, and a retry can all deliver the same message, and a mirrored
// transcript that duplicates lines is worse than one that lags.
func (db *Database) CreateMirroredSpaceMessage(ctx context.Context, link SpaceDiscordLink, content []MessageSpan, origin MessageOrigin) (*SpaceMessage, error) {
	if err := validateMessage(content, nil); err != nil {
		return nil, err
	}
	out := &SpaceMessage{ID: "msg_" + uuid.NewString(), SpaceID: link.SpaceID, ConversationID: link.ConversationID,
		SenderUserID: link.ConnectedByUserID, SenderKind: "person", SenderName: origin.AuthorName,
		Content: content, FileNodeIDs: []string{}, LibraryItemIDs: []string{}, Attachments: []MessageAttachment{}}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var duplicate bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_messages
			WHERE space_id=$1 AND origin->>'system'='discord' AND origin->>'external_id'=$2)`,
			link.SpaceID, origin.ExternalID).Scan(&duplicate); err != nil {
			return err
		}
		if duplicate {
			return errDiscordMessageAlreadyMirrored
		}
		raw, _ := json.Marshal(content)
		originRaw, _ := json.Marshal(origin)
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_messages(id,space_id,conversation_id,sender_user_id,sender_kind,content,origin)
			VALUES($1,$2,NULLIF($3,''),$4,'person',$5,$6) RETURNING seq,created_at`,
			out.ID, link.SpaceID, link.ConversationID, link.ConnectedByUserID, raw, originRaw).Scan(&out.Seq, &out.CreatedAt); err != nil {
			return err
		}
		out.Origin = originRaw
		_, err := recordSpaceEventTx(ctx, tx, link.SpaceID, link.ConnectedByUserID, "message.created", out.ID, out)
		return err
	})
	if errors.Is(err, errDiscordMessageAlreadyMirrored) {
		return nil, ErrSpaceConflict
	}
	if err != nil {
		return nil, err
	}
	return out, nil
}

var errDiscordMessageAlreadyMirrored = errors.New("discord message is already mirrored")

// SpaceMessageForPublish reads one message the caller owns, for mirroring out.
func (db *Database) SpaceMessageForPublish(ctx context.Context, userID, spaceID, messageID string) (*SpaceMessage, error) {
	out := &SpaceMessage{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		return scanSpaceMessage(tx.QueryRowContext(ctx, `SELECT `+spaceMessageColumns+` FROM space_messages m
			LEFT JOIN users u ON u.id=m.sender_user_id LEFT JOIN space_agents a ON a.id=m.sender_agent_id
			WHERE m.id=$1 AND m.space_id=$2`, messageID, spaceID), out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	if err != nil {
		return nil, err
	}
	return out, nil
}

// SetSpaceMessageOrigin stamps the outcome of an outward publish onto a
// message, so the transcript shows what actually reached Discord.
func (db *Database) SetSpaceMessageOrigin(ctx context.Context, spaceID, messageID string, origin MessageOrigin) (*SpaceMessage, error) {
	out := &SpaceMessage{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		originRaw, _ := json.Marshal(origin)
		if _, err := tx.ExecContext(ctx, `UPDATE space_messages SET origin=$1 WHERE id=$2 AND space_id=$3`,
			originRaw, messageID, spaceID); err != nil {
			return err
		}
		return scanSpaceMessage(tx.QueryRowContext(ctx, `SELECT `+spaceMessageColumns+` FROM space_messages m
			LEFT JOIN users u ON u.id=m.sender_user_id LEFT JOIN space_agents a ON a.id=m.sender_agent_id
			WHERE m.id=$1 AND m.space_id=$2`, messageID, spaceID), out)
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
