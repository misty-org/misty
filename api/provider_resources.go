package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/server/db"
)

type availableProviderResource struct {
	Provider           string          `json:"provider"`
	ResourceType       string          `json:"resource_type"`
	ExternalResourceID string          `json:"external_resource_id"`
	DisplayName        string          `json:"display_name"`
	Configuration      json.RawMessage `json:"configuration"`
}

func (s *SpacesService) AvailableProviderResources() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, integrationID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "integrationID")
		allowed, err := s.database.HasSpacePermission(r.Context(), userID, spaceID, db.PermissionIntegrationsManage)
		if err != nil || !allowed {
			writeSpaceError(w, db.ErrSpaceForbidden)
			return
		}
		discovered, err := s.discoverProviderResources(r.Context(), userID, spaceID, integrationID)
		if err != nil {
			writeProviderFailure(w, err)
			return
		}
		if r.Method == http.MethodGet {
			writeJSON(w, http.StatusOK, map[string]any{"resources": discovered})
			return
		}
		if r.Method != http.MethodPut {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Resources []struct {
				ResourceType       string `json:"resource_type"`
				ExternalResourceID string `json:"external_resource_id"`
			} `json:"resources"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		desired := make([]db.ProviderSharedResource, 0, len(body.Resources))
		seen := map[string]bool{}
		for _, requested := range body.Resources {
			key := requested.ResourceType + "\x00" + requested.ExternalResourceID
			if seen[key] {
				continue
			}
			seen[key] = true
			var selected *availableProviderResource
			for index := range discovered {
				if discovered[index].ResourceType == requested.ResourceType &&
					discovered[index].ExternalResourceID == requested.ExternalResourceID {
					selected = &discovered[index]
					break
				}
			}
			if selected == nil {
				writeSpaceError(w, db.ErrSpaceInvalid)
				return
			}
			desired = append(desired, db.ProviderSharedResource{
				Provider: selected.Provider, ResourceType: selected.ResourceType,
				ExternalResourceID: selected.ExternalResourceID, DisplayName: selected.DisplayName,
				Configuration: selected.Configuration,
			})
		}
		items, err := s.database.ReplaceProviderSharedResources(
			r.Context(), userID, spaceID, integrationID, desired,
		)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		for _, item := range items {
			resource := item
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				defer cancel()
				if backfillErr := s.backfillProviderResource(ctx, resource); backfillErr != nil {
					_ = s.database.SetProviderSharedResourceHealth(
						ctx, resource.ID, "needs_attention", providerErrorCode(backfillErr),
					)
				}
			}()
		}
		if len(discovered) > 0 {
			_ = s.database.SetSpaceSetupProviderStatus(
				r.Context(), userID, spaceID, discovered[0].Provider, "configured",
			)
		}
		writeJSON(w, http.StatusOK, map[string]any{"resources": items})
	}
}

func (s *SpacesService) ProviderSharedResources() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		switch r.Method {
		case http.MethodGet:
			items, err := s.database.ProviderSharedResources(r.Context(), userID, spaceID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"resources": items})
		case http.MethodPost:
			var body struct {
				IntegrationID      string          `json:"integration_id"`
				Provider           string          `json:"provider"`
				ResourceType       string          `json:"resource_type"`
				ExternalResourceID string          `json:"external_resource_id"`
				DisplayName        string          `json:"display_name"`
				Configuration      json.RawMessage `json:"configuration"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			discovered, err := s.discoverProviderResources(r.Context(), userID, spaceID, body.IntegrationID)
			if err != nil {
				writeProviderFailure(w, err)
				return
			}
			var selected *availableProviderResource
			for index := range discovered {
				if discovered[index].Provider == body.Provider && discovered[index].ResourceType == body.ResourceType && discovered[index].ExternalResourceID == body.ExternalResourceID {
					selected = &discovered[index]
					break
				}
			}
			if selected == nil {
				writeSpaceError(w, db.ErrSpaceInvalid)
				return
			}
			item, err := s.database.PublishProviderSharedResource(r.Context(), userID, db.ProviderSharedResource{SpaceID: spaceID, IntegrationID: body.IntegrationID, Provider: selected.Provider, ResourceType: selected.ResourceType, ExternalResourceID: selected.ExternalResourceID, DisplayName: selected.DisplayName, Configuration: selected.Configuration})
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			go func(resource db.ProviderSharedResource) {
				ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				defer cancel()
				if backfillErr := s.backfillProviderResource(ctx, resource); backfillErr != nil {
					_ = s.database.SetProviderSharedResourceHealth(ctx, resource.ID, "needs_attention", providerErrorCode(backfillErr))
				}
			}(*item)
			_ = s.database.SetSpaceSetupProviderStatus(
				r.Context(), userID, spaceID, selected.Provider, "configured",
			)
			writeJSON(w, http.StatusCreated, item)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpacesService) backfillProviderResource(ctx context.Context, resource db.ProviderSharedResource) error {
	token, tokenType, err := s.providerTokenForSharedResource(ctx, resource)
	if err != nil {
		return err
	}
	switch resource.Provider {
	case "slack":
		query := url.Values{"channel": {resource.ExternalResourceID}, "limit": {"100"}, "inclusive": {"true"}}
		payload, err := providerJSONRequest(ctx, token, tokenType, http.MethodGet, "https://slack.com/api/conversations.history?"+query.Encode(), nil, nil)
		if err != nil {
			return err
		}
		var page struct {
			OK       bool `json:"ok"`
			Messages []struct {
				TS       string          `json:"ts"`
				ThreadTS string          `json:"thread_ts"`
				User     string          `json:"user"`
				BotID    string          `json:"bot_id"`
				Text     string          `json:"text"`
				Files    json.RawMessage `json:"files"`
			} `json:"messages"`
		}
		if json.Unmarshal(payload, &page) != nil || !page.OK {
			return errors.New("slack history backfill failed")
		}
		for _, message := range page.Messages {
			content, _ := json.Marshal(map[string]any{"channel": resource.ExternalResourceID, "ts": message.TS, "thread_ts": message.ThreadTS, "user": message.User, "bot_id": message.BotID, "text": message.Text, "files": json.RawMessage(message.Files)})
			if err := s.database.UpsertProviderContentRecord(ctx, db.ProviderContentRecord{SpaceID: resource.SpaceID, SharedResourceID: resource.ID, Provider: "slack", ExternalRecordID: message.TS, ParentExternalID: message.ThreadTS, RecordType: "message", Fingerprint: providerPayloadFingerprint(content), DisplayName: resource.DisplayName + " · " + message.User, MIMEType: "application/vnd.slack.message+json", OccurredAt: slackTimestamp(message.TS), Content: content}); err != nil {
				return err
			}
		}
	case "discord":
		payload, err := providerJSONRequest(ctx, token, "Bot", http.MethodGet, "https://discord.com/api/v10/channels/"+url.PathEscape(resource.ExternalResourceID)+"/messages?limit=100", nil, nil)
		if err != nil {
			return err
		}
		var messages []map[string]any
		if json.Unmarshal(payload, &messages) != nil {
			return errors.New("discord history backfill failed")
		}
		for _, message := range messages {
			externalID, _ := message["id"].(string)
			if externalID == "" {
				continue
			}
			content, _ := json.Marshal(message)
			display := resource.DisplayName
			if author, _ := message["author"].(map[string]any); author != nil {
				if username, _ := author["username"].(string); username != "" {
					display += " · " + username
				}
			}
			var occurredAt *time.Time
			if timestamp, _ := message["timestamp"].(string); timestamp != "" {
				if parsed, parseErr := time.Parse(time.RFC3339Nano, timestamp); parseErr == nil {
					occurredAt = &parsed
				}
			}
			if err := s.database.UpsertProviderContentRecord(ctx, db.ProviderContentRecord{SpaceID: resource.SpaceID, SharedResourceID: resource.ID, Provider: "discord", ExternalRecordID: externalID, RecordType: "message", Fingerprint: providerPayloadFingerprint(content), DisplayName: display, MIMEType: "application/vnd.discord.message+json", OccurredAt: occurredAt, Content: content}); err != nil {
				return err
			}
		}
	case "notion":
		event := notionWebhookEvent{ID: "initial:" + resource.ID, Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Type: resource.ResourceType + ".initial_sync"}
		event.Entity.ID, event.Entity.Type = resource.ExternalResourceID, resource.ResourceType
		if event.Entity.Type == "data_source" || event.Entity.Type == "database" || event.Entity.Type == "page" {
			if err := s.fetchAndStoreNotionEntity(ctx, resource, event, mustAPIRawJSON(event)); err != nil {
				return err
			}
			break
		}
		return db.ErrSpaceInvalid
	}
	return s.database.SetProviderSharedResourceHealth(ctx, resource.ID, "active", "")
}

func (s *SpacesService) ProviderSharedResource() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if err := s.database.DisableProviderSharedResource(r.Context(), userID, chi.URLParam(r, "spaceID"), chi.URLParam(r, "resourceID")); err != nil {
			writeSpaceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *SpacesService) discoverProviderResources(ctx context.Context, userID, spaceID, integrationID string) ([]availableProviderResource, error) {
	credential, err := s.database.ProviderCredential(ctx, userID, spaceID, integrationID)
	if err != nil {
		return nil, err
	}
	token, tokenType, err := s.providerAccessToken(ctx, userID, spaceID, integrationID)
	if err != nil {
		return nil, err
	}
	switch credential.Provider {
	case "slack":
		return discoverSlackChannels(ctx, token)
	case "discord":
		return discoverDiscordChannels(ctx)
	case "notion":
		return discoverNotionResources(ctx, token, tokenType)
	default:
		return nil, db.ErrSpaceInvalid
	}
}

func discoverSlackChannels(ctx context.Context, token string) ([]availableProviderResource, error) {
	items := []availableProviderResource{}
	cursor := ""
	for pages := 0; pages < 20; pages++ {
		query := url.Values{"exclude_archived": {"true"}, "limit": {"200"}, "types": {"public_channel,private_channel"}}
		if cursor != "" {
			query.Set("cursor", cursor)
		}
		payload, err := providerJSONRequest(ctx, token, "Bearer", http.MethodGet, "https://slack.com/api/conversations.list?"+query.Encode(), nil, nil)
		if err != nil {
			return nil, err
		}
		var page struct {
			OK       bool   `json:"ok"`
			Error    string `json:"error"`
			Channels []struct {
				ID, Name            string
				IsPrivate, IsMember bool
			} `json:"channels"`
			Metadata struct {
				NextCursor string `json:"next_cursor"`
			} `json:"response_metadata"`
		}
		if json.Unmarshal(payload, &page) != nil || !page.OK {
			if page.Error == "" {
				page.Error = "invalid_response"
			}
			return nil, errors.New("slack resource discovery failed: " + page.Error)
		}
		for _, channel := range page.Channels {
			if channel.ID == "" || !channel.IsMember {
				continue
			}
			config, _ := json.Marshal(map[string]any{"private": channel.IsPrivate})
			items = append(items, availableProviderResource{Provider: "slack", ResourceType: "channel", ExternalResourceID: channel.ID, DisplayName: "#" + channel.Name, Configuration: config})
		}
		cursor = page.Metadata.NextCursor
		if cursor == "" {
			break
		}
	}
	return items, nil
}

func discoverDiscordChannels(ctx context.Context) ([]availableProviderResource, error) {
	token := strings.TrimSpace(os.Getenv("DISCORD_BOT_TOKEN"))
	if token == "" {
		return nil, errors.New("discord bot is not configured")
	}
	guildPayload, err := providerJSONRequest(ctx, token, "Bot", http.MethodGet, "https://discord.com/api/v10/users/@me/guilds?limit=200", nil, nil)
	if err != nil {
		return nil, err
	}
	var guilds []struct{ ID, Name string }
	if json.Unmarshal(guildPayload, &guilds) != nil {
		return nil, errors.New("discord guild response was invalid")
	}
	items := []availableProviderResource{}
	for _, guild := range guilds {
		payload, requestErr := providerJSONRequest(ctx, token, "Bot", http.MethodGet, "https://discord.com/api/v10/guilds/"+url.PathEscape(guild.ID)+"/channels", nil, nil)
		if requestErr != nil {
			continue
		}
		var channels []struct {
			ID, Name string
			Type     int
		}
		if json.Unmarshal(payload, &channels) != nil {
			continue
		}
		for _, channel := range channels {
			if channel.Type != 0 && channel.Type != 5 && channel.Type != 15 {
				continue
			}
			config, _ := json.Marshal(map[string]string{"guildId": guild.ID, "guildName": guild.Name})
			items = append(items, availableProviderResource{Provider: "discord", ResourceType: "channel", ExternalResourceID: channel.ID, DisplayName: guild.Name + " / #" + channel.Name, Configuration: config})
		}
	}
	return items, nil
}

func discoverNotionResources(ctx context.Context, token, tokenType string) ([]availableProviderResource, error) {
	payload, err := providerJSONRequest(ctx, token, tokenType, http.MethodPost, "https://api.notion.com/v1/search", map[string]any{"page_size": 100, "sort": map[string]string{"direction": "descending", "timestamp": "last_edited_time"}}, map[string]string{"Notion-Version": "2026-03-11"})
	if err != nil {
		return nil, err
	}
	var response struct {
		Results []map[string]any `json:"results"`
	}
	if json.Unmarshal(payload, &response) != nil {
		return nil, errors.New("notion search response was invalid")
	}
	items := []availableProviderResource{}
	for _, result := range response.Results {
		id, _ := result["id"].(string)
		object, _ := result["object"].(string)
		if id == "" {
			continue
		}
		resourceType := object
		if object == "data_source" || object == "database" || object == "page" {
		} else {
			continue
		}
		title := notionObjectTitle(result)
		if title == "" {
			title = "Untitled " + strings.ReplaceAll(resourceType, "_", " ")
		}
		items = append(items, availableProviderResource{Provider: "notion", ResourceType: resourceType, ExternalResourceID: id, DisplayName: title, Configuration: json.RawMessage(`{}`)})
	}
	return items, nil
}

func notionObjectTitle(value map[string]any) string {
	if title, ok := value["title"].([]any); ok {
		return notionRichText(title)
	}
	properties, _ := value["properties"].(map[string]any)
	for _, property := range properties {
		item, _ := property.(map[string]any)
		kind, _ := item["type"].(string)
		if kind != "title" {
			continue
		}
		values, _ := item["title"].([]any)
		if title := notionRichText(values); title != "" {
			return title
		}
	}
	return ""
}

func notionRichText(values []any) string {
	var text strings.Builder
	for _, raw := range values {
		value, _ := raw.(map[string]any)
		plain, _ := value["plain_text"].(string)
		text.WriteString(plain)
	}
	return strings.TrimSpace(text.String())
}

func providerJSONRequest(ctx context.Context, token, tokenType, method, endpoint string, body any, headers map[string]string) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		encoded, _ := json.Marshal(body)
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return nil, err
	}
	if tokenType == "" {
		tokenType = "Bearer"
	}
	request.Header.Set("Authorization", tokenType+" "+token)
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 4<<20+1))
	if err != nil {
		return nil, err
	}
	if len(payload) > 4<<20 {
		return nil, errors.New("provider response exceeded 4 MiB")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		digest := sha256.Sum256(payload)
		return payload, errors.New("provider request failed with " + response.Status + " (body " + hex.EncodeToString(digest[:6]) + ")")
	}
	return payload, nil
}
