package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/server/db"
)

// Discord's hard limit on message content. Mirrored text is trimmed, never
// dropped: losing the tail of someone's message is worse than an ellipsis.
const discordContentLimit = 2000

// Discord message types Misty mirrors. 0 = default, 19 = inline reply.
var mirroredDiscordMessageTypes = map[int]bool{0: true, 19: true}

var discordUserMentionPattern = regexp.MustCompile(`<@!?(\d+)>`)
var discordChannelMentionPattern = regexp.MustCompile(`<#(\d+)>`)
var discordRoleMentionPattern = regexp.MustCompile(`<@&(\d+)>`)

func discordBotToken() string { return strings.TrimSpace(os.Getenv("DISCORD_BOT_TOKEN")) }

// discordMessage is the subset of Discord's REST/Gateway message Misty reads.
type discordMessage struct {
	ID        string `json:"id"`
	ChannelID string `json:"channel_id"`
	GuildID   string `json:"guild_id"`
	Content   string `json:"content"`
	Timestamp string `json:"timestamp"`
	Type      int    `json:"type"`
	WebhookID string `json:"webhook_id"`
	Author    struct {
		ID         string `json:"id"`
		Username   string `json:"username"`
		GlobalName string `json:"global_name"`
		Avatar     string `json:"avatar"`
		Bot        bool   `json:"bot"`
	} `json:"author"`
	Attachments []struct {
		ID       string `json:"id"`
		Filename string `json:"filename"`
		URL      string `json:"url"`
	} `json:"attachments"`
	Mentions []struct {
		ID         string `json:"id"`
		Username   string `json:"username"`
		GlobalName string `json:"global_name"`
	} `json:"mentions"`
	ReferencedMessage *struct {
		ID string `json:"id"`
	} `json:"referenced_message"`
}

// SpaceDiscordLink serves the Space's Discord links and creates or reconnects
// one channel link.
func (s *SpacesService) SpaceDiscordLink() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		switch r.Method {
		case http.MethodGet:
			links, err := s.database.SpaceDiscordLinksFor(r.Context(), userID, spaceID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"links": links})
		case http.MethodPost:
			var body struct {
				IntegrationID string `json:"integration_id"`
				ChannelID     string `json:"channel_id"`
				ChannelName   string `json:"channel_name"`
				GuildID       string `json:"guild_id"`
				GuildName     string `json:"guild_name"`
				Direction     string `json:"direction"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			if discordBotToken() == "" {
				writeJSON(w, http.StatusFailedDependency, map[string]string{"code": "provider_not_configured"})
				return
			}
			// Verify the bot can actually see the channel before storing a link
			// that would otherwise fail silently on every later sync.
			channel, err := s.discordChannel(r.Context(), body.ChannelID)
			if err != nil {
				writeProviderFailure(w, err)
				return
			}
			if body.GuildID == "" {
				body.GuildID = channel.GuildID
			}
			if strings.TrimSpace(body.ChannelName) == "" {
				body.ChannelName = channel.Name
			}
			item := db.SpaceDiscordLink{
				SpaceID: spaceID, IntegrationID: body.IntegrationID,
				GuildID: body.GuildID, GuildName: body.GuildName, ChannelID: body.ChannelID,
				ChannelName: body.ChannelName, Direction: body.Direction,
			}
			if identity, identityErr := s.discordBotIdentity(r.Context()); identityErr == nil {
				item.BotUserID = identity
			}
			// A webhook lets each mirrored message post under its Misty author's
			// own name. It is optional: without Manage Webhooks the link still
			// works, posting as the bot with an attributed prefix.
			if webhookID, token, hookErr := s.createDiscordWebhook(r.Context(), body.ChannelID); hookErr == nil {
				if ciphertext, nonce, sealErr := s.encryptProviderSecret("discord", []byte(token)); sealErr == nil {
					item.WebhookID, item.WebhookCiphertext, item.WebhookNonce = webhookID, ciphertext, nonce
				}
			}
			link, err := s.database.CreateSpaceDiscordLink(r.Context(), userID, item)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			_ = s.database.SetSpaceSetupProviderStatus(r.Context(), userID, spaceID, "discord", "configured")
			// Backfill immediately so a freshly linked channel is not empty.
			if _, syncErr := s.syncDiscordLink(r.Context(), link); syncErr != nil {
				_ = s.database.SetSpaceDiscordLinkSync(r.Context(), link.ID, "", "needs_attention", providerErrorCode(syncErr), nil)
			}
			refreshed, err := s.database.SpaceDiscordLinkByID(r.Context(), spaceID, link.ID)
			if err != nil {
				writeJSON(w, http.StatusCreated, link)
				return
			}
			writeJSON(w, http.StatusCreated, refreshed)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// SpaceDiscordLinkItem changes the mirror direction or removes the link.
func (s *SpacesService) SpaceDiscordLinkItem() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, linkID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "linkID")
		switch r.Method {
		case http.MethodPatch:
			var body struct {
				Direction string `json:"direction"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			link, err := s.database.UpdateSpaceDiscordLinkDirection(r.Context(), userID, spaceID, linkID, body.Direction)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, link)
		case http.MethodDelete:
			if err := s.database.DeleteSpaceDiscordLink(r.Context(), userID, spaceID, linkID); err != nil {
				writeSpaceError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// SyncSpaceDiscordLink pulls messages after the stored cursor. Safe to call
// repeatedly: the cursor plus the per-message uniqueness check make it
// idempotent, so a retry cannot duplicate a transcript.
func (s *SpacesService) SyncSpaceDiscordLink() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, linkID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "linkID")
		if _, err := s.database.SpaceDiscordLinkFor(r.Context(), userID, spaceID); err != nil {
			writeSpaceError(w, err)
			return
		}
		link, err := s.database.SpaceDiscordLinkByID(r.Context(), spaceID, linkID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		imported, syncErr := s.syncDiscordLink(r.Context(), link)
		if syncErr != nil {
			_ = s.database.SetSpaceDiscordLinkSync(r.Context(), link.ID, "", "needs_attention", providerErrorCode(syncErr), nil)
		}
		refreshed, err := s.database.SpaceDiscordLinkByID(r.Context(), spaceID, linkID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		response := map[string]any{"link": refreshed, "imported": imported, "skipped": 0}
		if syncErr != nil {
			response["error"] = discordFailureMessage(providerErrorCode(syncErr))
		}
		writeJSON(w, http.StatusOK, response)
	}
}

// PublishSpaceDiscordMessage mirrors one Misty message outward. The desktop
// calls it automatically for two-way Discord conversations and may retry a
// failed individual message without duplicating inbound traffic.
func (s *SpacesService) PublishSpaceDiscordMessage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, linkID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "linkID")
		var body struct {
			MessageID string `json:"message_id"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		links, err := s.database.SpaceDiscordLinksFor(r.Context(), userID, spaceID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		var link *db.SpaceDiscordLink
		for index := range links {
			if links[index].ID == linkID {
				link = &links[index]
				break
			}
		}
		if link == nil {
			writeSpaceError(w, db.ErrSpaceNotFound)
			return
		}
		if link.Direction == "inbound" {
			writeJSON(w, http.StatusConflict, map[string]string{"code": "outbound_disabled"})
			return
		}
		message, err := s.database.SpaceMessageForPublish(r.Context(), userID, spaceID, body.MessageID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if message.ConversationID != link.ConversationID {
			writeSpaceError(w, db.ErrSpaceForbidden)
			return
		}
		if !publishableToDiscord(message, userID) {
			writeSpaceError(w, db.ErrSpaceForbidden)
			return
		}
		origin := db.MessageOrigin{System: "misty", PublishState: "published", ExternalChannelID: link.ChannelID}
		external, publishErr := s.postDiscordMessage(r.Context(), link, message)
		if publishErr != nil {
			origin.PublishState = "failed"
			origin.PublishError = discordFailureMessage(providerErrorCode(publishErr))
		} else {
			origin.PublishedExternal = external
			origin.PublishedAt = time.Now().UTC().Format(time.RFC3339)
		}
		updated, err := s.database.SetSpaceMessageOrigin(r.Context(), spaceID, message.ID, origin)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"message": updated})
	}
}

// publishableToDiscord mirrors the client's rule set exactly. Agent output and
// system notices stay inside the Space, and a Discord-sourced message is never
// bounced back — that is what keeps the mirror from looping.
func publishableToDiscord(message *db.SpaceMessage, userID string) bool {
	if message.SenderKind != "person" || message.SenderUserID != userID {
		return false
	}
	if len(message.Origin) > 0 {
		var origin db.MessageOrigin
		if json.Unmarshal(message.Origin, &origin) == nil && origin.System != "" && origin.System != "misty" {
			return false
		}
	}
	return strings.TrimSpace(spansToPlainText(message.Content)) != ""
}

func spansToPlainText(spans []db.MessageSpan) string {
	var builder strings.Builder
	for _, span := range spans {
		if span.Type == "text" {
			builder.WriteString(span.Text)
			continue
		}
		builder.WriteString("@" + span.Label)
	}
	return builder.String()
}

// postDiscordMessage sends through the link's webhook when one exists, so the
// message carries its Misty author's name, and falls back to the bot identity
// with an attributed prefix otherwise.
func (s *SpacesService) postDiscordMessage(ctx context.Context, link *db.SpaceDiscordLink, message *db.SpaceMessage) (string, error) {
	content := truncateForDiscord(strings.TrimSpace(spansToPlainText(message.Content)))
	if content == "" {
		return "", db.ErrSpaceInvalid
	}
	author := strings.TrimSpace(message.SenderName)
	if author == "" {
		author = "Misty"
	}
	// An empty parse list means a mirrored "@everyone" cannot ping a Discord
	// server. Mirroring must never escalate reach on a user's behalf.
	payload := map[string]any{"allowed_mentions": map[string]any{"parse": []string{}}}

	if link.WebhookID != "" && len(link.WebhookCiphertext) > 0 {
		token, err := s.decryptProviderSecret("discord", link.WebhookCiphertext, link.WebhookNonce)
		if err == nil {
			payload["content"], payload["username"] = content, author
			endpoint := "https://discord.com/api/v10/webhooks/" + url.PathEscape(link.WebhookID) + "/" + url.PathEscape(string(token)) + "?wait=true"
			raw, postErr := providerJSONRequest(ctx, "", "", http.MethodPost, endpoint, payload, nil)
			if postErr == nil {
				var created struct {
					ID string `json:"id"`
				}
				_ = json.Unmarshal(raw, &created)
				return created.ID, nil
			}
			// A deleted or rotated webhook must not block publishing; fall
			// through to the bot identity rather than failing the write.
		}
	}

	payload["content"] = truncateForDiscord("**" + author + "**: " + content)
	delete(payload, "username")
	endpoint := "https://discord.com/api/v10/channels/" + url.PathEscape(link.ChannelID) + "/messages"
	raw, err := providerJSONRequest(ctx, discordBotToken(), "Bot", http.MethodPost, endpoint, payload, nil)
	if err != nil {
		return "", err
	}
	var created struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &created)
	return created.ID, nil
}

func truncateForDiscord(content string) string {
	runes := []rune(content)
	if len(runes) <= discordContentLimit {
		return content
	}
	return string(runes[:discordContentLimit-1]) + "…"
}

// syncDiscordLink imports every message after the stored cursor.
func (s *SpacesService) syncDiscordLink(ctx context.Context, link *db.SpaceDiscordLink) (int, error) {
	if link == nil {
		return 0, nil
	}
	if discordBotToken() == "" {
		return 0, errors.New("discord bot is not configured")
	}
	if channel, err := s.discordChannel(ctx, link.ChannelID); err == nil &&
		strings.TrimSpace(channel.Name) != "" && channel.Name != link.ChannelName {
		if err := s.database.UpdateSpaceDiscordLinkDisplay(ctx, link.ID, channel.Name); err == nil {
			link.ChannelName = channel.Name
		}
	}
	if link.Direction == "outbound" {
		return 0, nil
	}
	values := url.Values{"limit": {"100"}}
	if link.LastMessageID != "" {
		values.Set("after", link.LastMessageID)
	}
	endpoint := "https://discord.com/api/v10/channels/" + url.PathEscape(link.ChannelID) + "/messages?" + values.Encode()
	raw, err := providerJSONRequest(ctx, discordBotToken(), "Bot", http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return 0, err
	}
	var messages []discordMessage
	if json.Unmarshal(raw, &messages) != nil {
		return 0, errors.New("discord message history was invalid")
	}
	// Discord returns newest first; mirror oldest first so the Space transcript
	// reads in the order the conversation actually happened.
	imported, cursor := 0, link.LastMessageID
	for index := len(messages) - 1; index >= 0; index-- {
		message := messages[index]
		if snowflakeAfter(message.ID, cursor) {
			cursor = message.ID
		}
		if !shouldMirrorDiscordMessage(message, link) {
			continue
		}
		if _, mirrorErr := s.mirrorDiscordMessage(ctx, *link, message); mirrorErr == nil {
			imported++
		}
	}
	now := time.Now().UTC()
	return imported, s.database.SetSpaceDiscordLinkSync(ctx, link.ID, cursor, "active", "", &now)
}

// shouldMirrorDiscordMessage decides whether a Discord message becomes a Misty
// message. The bot-and-webhook rule is what stops an infinite mirror loop:
// anything Misty itself posted comes back down the same channel read.
func shouldMirrorDiscordMessage(message discordMessage, link *db.SpaceDiscordLink) bool {
	if link.Direction == "outbound" {
		return false
	}
	if !mirroredDiscordMessageTypes[message.Type] {
		return false
	}
	if message.WebhookID != "" {
		return false
	}
	if link.BotUserID != "" && message.Author.ID == link.BotUserID {
		return false
	}
	if message.Author.Bot && link.BotUserID == "" {
		return false
	}
	return strings.TrimSpace(message.Content) != "" || len(message.Attachments) > 0
}

// mirrorDiscordMessage writes one Discord message into the linked Space.
func (s *SpacesService) mirrorDiscordMessage(ctx context.Context, link db.SpaceDiscordLink, message discordMessage) (*db.SpaceMessage, error) {
	labels := map[string]string{}
	for _, mention := range message.Mentions {
		name := strings.TrimSpace(mention.GlobalName)
		if name == "" {
			name = mention.Username
		}
		labels[mention.ID] = name
	}
	content := discordContentToSpans(message, labels)
	origin := db.MessageOrigin{
		System: "discord", ExternalID: message.ID, ExternalChannelID: message.ChannelID,
		AuthorName: discordDisplayName(message), AuthorHandle: message.Author.Username,
		AuthoredAt: message.Timestamp,
	}
	if message.Author.Avatar != "" {
		origin.AuthorAvatarURL = "https://cdn.discordapp.com/avatars/" + message.Author.ID + "/" + message.Author.Avatar + ".png"
	}
	for _, attachment := range message.Attachments {
		origin.AttachmentURLs = append(origin.AttachmentURLs, attachment.URL)
	}
	return s.database.CreateMirroredSpaceMessage(ctx, link, content, origin)
}

// discordContentToSpans rewrites Discord's id-based mention tokens into text a
// person can read, rather than leaking `<@980…>` into the transcript.
func discordContentToSpans(message discordMessage, labels map[string]string) []db.MessageSpan {
	text := message.Content
	replaceMention := func(pattern *regexp.Regexp, prefix string) {
		text = pattern.ReplaceAllStringFunc(text, func(token string) string {
			matches := pattern.FindStringSubmatch(token)
			if len(matches) < 2 {
				return token
			}
			if label, exists := labels[matches[1]]; exists && label != "" {
				return prefix + label
			}
			return token
		})
	}
	replaceMention(discordUserMentionPattern, "@")
	replaceMention(discordRoleMentionPattern, "@")
	replaceMention(discordChannelMentionPattern, "#")

	if len(message.Attachments) > 0 {
		names := make([]string, 0, len(message.Attachments))
		for _, attachment := range message.Attachments {
			names = append(names, attachment.Filename)
		}
		summary := "📎 " + strings.Join(names, ", ")
		if strings.TrimSpace(text) == "" {
			text = summary
		} else {
			text += "\n" + summary
		}
	}
	// Misty caps a message at 4000 characters. A Discord message plus its
	// attachment summary can exceed that, and a rejected insert would drop the
	// message entirely — trimming keeps the transcript complete.
	if runes := []rune(text); len(runes) > mistyMessageCharLimit {
		text = string(runes[:mistyMessageCharLimit-1]) + "…"
	}
	return []db.MessageSpan{{Type: "text", Text: text}}
}

// Mirrors db.MaxMessageChars, which mirrored content must also respect.
const mistyMessageCharLimit = 4000

func discordDisplayName(message discordMessage) string {
	if name := strings.TrimSpace(message.Author.GlobalName); name != "" {
		return name
	}
	if name := strings.TrimSpace(message.Author.Username); name != "" {
		return name
	}
	return "Discord user"
}

// snowflakeAfter compares Discord ids numerically. A plain string comparison
// would order "9" after "10" and silently rewind the cursor.
func snowflakeAfter(candidate, reference string) bool {
	if reference == "" {
		return true
	}
	if len(candidate) != len(reference) {
		return len(candidate) > len(reference)
	}
	return candidate > reference
}

type discordChannelMetadata struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	GuildID string `json:"guild_id"`
	Type    int    `json:"type"`
}

func (s *SpacesService) discordChannel(ctx context.Context, channelID string) (discordChannelMetadata, error) {
	var channel discordChannelMetadata
	if strings.TrimSpace(channelID) == "" {
		return channel, db.ErrSpaceInvalid
	}
	raw, err := providerJSONRequest(ctx, discordBotToken(), "Bot", http.MethodGet,
		"https://discord.com/api/v10/channels/"+url.PathEscape(channelID), nil, nil)
	if err != nil {
		return channel, err
	}
	if json.Unmarshal(raw, &channel) != nil || channel.ID == "" {
		return channel, errors.New("discord channel response was invalid")
	}
	return channel, nil
}

func (s *SpacesService) discordBotIdentity(ctx context.Context) (string, error) {
	raw, err := providerJSONRequest(ctx, discordBotToken(), "Bot", http.MethodGet,
		"https://discord.com/api/v10/users/@me", nil, nil)
	if err != nil {
		return "", err
	}
	var identity struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(raw, &identity) != nil || identity.ID == "" {
		return "", errors.New("discord identity response was invalid")
	}
	return identity.ID, nil
}

func (s *SpacesService) createDiscordWebhook(ctx context.Context, channelID string) (string, string, error) {
	raw, err := providerJSONRequest(ctx, discordBotToken(), "Bot", http.MethodPost,
		"https://discord.com/api/v10/channels/"+url.PathEscape(channelID)+"/webhooks",
		map[string]any{"name": "Misty"}, nil)
	if err != nil {
		return "", "", err
	}
	var webhook struct {
		ID    string `json:"id"`
		Token string `json:"token"`
	}
	if json.Unmarshal(raw, &webhook) != nil || webhook.ID == "" || webhook.Token == "" {
		return "", "", errors.New("discord webhook response was invalid")
	}
	return webhook.ID, webhook.Token, nil
}

// discordFailureMessage turns a provider error code into user-facing copy.
// Discord's own error bodies are not something a person should have to read.
func discordFailureMessage(code string) string {
	switch code {
	case "permission_missing":
		return "Misty lost access to this Discord channel. Check the bot's permissions."
	case "connection_revoked":
		return "Reconnect Discord to keep mirroring this channel."
	case "rate_limited":
		return "Discord is rate limiting Misty. Syncing will resume shortly."
	case "not_found":
		return "That Discord channel no longer exists."
	default:
		return "Misty could not reach Discord just now."
	}
}
