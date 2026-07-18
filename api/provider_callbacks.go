package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/kannachi323/misty/server/db"
)

const providerCallbackBodyLimit = 2 << 20

func (s *SpacesService) SlackEventsCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, err := readProviderCallbackBody(r)
		if err != nil || !verifySlackRequest(raw, r.Header, time.Now().UTC(), strings.TrimSpace(os.Getenv("SLACK_SIGNING_SECRET"))) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "invalid_signature"})
			return
		}
		var envelope slackEventEnvelope
		if json.Unmarshal(raw, &envelope) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_payload"})
			return
		}
		if envelope.Type == "url_verification" {
			if envelope.Challenge == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"code": "challenge_missing"})
				return
			}
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = io.WriteString(w, envelope.Challenge)
			return
		}
		w.WriteHeader(http.StatusOK)
		payload := append([]byte(nil), raw...)
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			_ = s.processSlackEvent(ctx, envelope, payload)
		}()
	}
}

type slackEventEnvelope struct {
	Type      string `json:"type"`
	EventID   string `json:"event_id"`
	TeamID    string `json:"team_id"`
	Challenge string `json:"challenge"`
	Event     struct {
		Type      string          `json:"type"`
		Subtype   string          `json:"subtype"`
		Channel   string          `json:"channel"`
		User      string          `json:"user"`
		BotID     string          `json:"bot_id"`
		Text      string          `json:"text"`
		Timestamp string          `json:"ts"`
		ThreadTS  string          `json:"thread_ts"`
		EventTS   string          `json:"event_ts"`
		DeletedTS string          `json:"deleted_ts"`
		Files     json.RawMessage `json:"files"`
		Message   json.RawMessage `json:"message"`
		Previous  json.RawMessage `json:"previous_message"`
	} `json:"event"`
}

func (s *SpacesService) processSlackEvent(ctx context.Context, envelope slackEventEnvelope, raw []byte) error {
	if envelope.EventID == "" || envelope.Event.Channel == "" {
		return errors.New("slack event identity is missing")
	}
	resources, err := s.database.MatchingProviderResources(ctx, "slack", envelope.TeamID, envelope.Event.Channel)
	if err != nil {
		return err
	}
	for _, resource := range resources {
		claimed, claimErr := s.database.EnqueueProviderEvent(ctx, resource, envelope.EventID, raw)
		if claimErr != nil || !claimed {
			continue
		}
		state := "processed"
		if err := s.storeSlackEvent(ctx, resource, envelope, raw); err != nil {
			state = "failed"
		} else {
			_, _ = s.ProcessProviderEvent(ctx, resource, envelope.EventID, providerPayloadFingerprint(raw), json.RawMessage(raw))
		}
		_ = s.database.FinishProviderEvent(ctx, resource.IntegrationID, envelope.EventID, state)
	}
	return nil
}

func (s *SpacesService) storeSlackEvent(ctx context.Context, resource db.ProviderSharedResource, envelope slackEventEnvelope, raw []byte) error {
	event := envelope.Event
	if event.Subtype == "message_changed" && len(event.Message) > 0 {
		var changed struct {
			Timestamp string          `json:"ts"`
			ThreadTS  string          `json:"thread_ts"`
			User      string          `json:"user"`
			BotID     string          `json:"bot_id"`
			Text      string          `json:"text"`
			Files     json.RawMessage `json:"files"`
		}
		if json.Unmarshal(event.Message, &changed) == nil && changed.Timestamp != "" {
			event.Timestamp, event.ThreadTS, event.User, event.BotID, event.Text = changed.Timestamp, changed.ThreadTS, changed.User, changed.BotID, changed.Text
			if len(changed.Files) > 0 {
				event.Files = changed.Files
			}
		}
	}
	externalID := event.Timestamp
	if event.DeletedTS != "" {
		externalID = event.DeletedTS
	}
	if externalID == "" {
		externalID = event.EventTS
	}
	if externalID == "" {
		return errors.New("slack message identity is missing")
	}
	content := map[string]any{"type": event.Type, "subtype": event.Subtype, "channel": event.Channel, "user": event.User, "bot_id": event.BotID, "text": event.Text, "ts": externalID, "thread_ts": event.ThreadTS}
	if len(event.Files) > 0 {
		content["files"] = json.RawMessage(event.Files)
	}
	if len(event.Message) > 0 {
		content["message"] = json.RawMessage(event.Message)
	}
	if len(event.Previous) > 0 {
		content["previous_message"] = json.RawMessage(event.Previous)
	}
	encoded, _ := json.Marshal(content)
	occurredAt := slackTimestamp(externalID)
	var deletedAt *time.Time
	if event.Subtype == "message_deleted" || event.Type == "message_deleted" {
		now := time.Now().UTC()
		deletedAt = &now
	}
	return s.database.UpsertProviderContentRecord(ctx, db.ProviderContentRecord{SpaceID: resource.SpaceID, SharedResourceID: resource.ID, Provider: "slack", ExternalRecordID: externalID, ParentExternalID: event.ThreadTS, RecordType: "message", Fingerprint: providerPayloadFingerprint(raw), DisplayName: resource.DisplayName + " · " + event.User, MIMEType: "application/vnd.slack.message+json", OccurredAt: occurredAt, Content: encoded, DeletedAt: deletedAt})
}

func verifySlackRequest(raw []byte, headers http.Header, now time.Time, secret string) bool {
	if secret == "" {
		return false
	}
	timestamp := headers.Get("X-Slack-Request-Timestamp")
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || now.Sub(time.Unix(seconds, 0)).Abs() > 5*time.Minute {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte("v0:" + timestamp + ":"))
	_, _ = mac.Write(raw)
	want := "v0=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(headers.Get("X-Slack-Signature")))
}

func slackTimestamp(value string) *time.Time {
	parts := strings.SplitN(value, ".", 2)
	seconds, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return nil
	}
	valueTime := time.Unix(seconds, 0).UTC()
	return &valueTime
}

func (s *SpacesService) NotionEventsCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, err := readProviderCallbackBody(r)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_payload"})
			return
		}
		var probe map[string]any
		_ = json.Unmarshal(raw, &probe)
		if verification, _ := probe["verification_token"].(string); verification != "" {
			// Notion's one-time subscription verification is completed in the
			// provider console. Never persist the token from an inbound request.
			w.WriteHeader(http.StatusOK)
			return
		}
		secret := strings.TrimSpace(os.Getenv("NOTION_WEBHOOK_VERIFICATION_TOKEN"))
		if !verifyNotionRequest(raw, r.Header.Get("X-Notion-Signature"), secret) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "invalid_signature"})
			return
		}
		var event notionWebhookEvent
		if json.Unmarshal(raw, &event) != nil || event.ID == "" || event.Entity.ID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_payload"})
			return
		}
		w.WriteHeader(http.StatusOK)
		payload := append([]byte(nil), raw...)
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			_ = s.processNotionEvent(ctx, event, payload)
		}()
	}
}

type notionWebhookEvent struct {
	ID          string `json:"id"`
	Timestamp   string `json:"timestamp"`
	WorkspaceID string `json:"workspace_id"`
	Type        string `json:"type"`
	Entity      struct {
		ID   string `json:"id"`
		Type string `json:"type"`
	} `json:"entity"`
	Data struct {
		Parent struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		} `json:"parent"`
	} `json:"data"`
}

func verifyNotionRequest(raw []byte, signature, secret string) bool {
	if secret == "" || !strings.HasPrefix(signature, "sha256=") {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(raw)
	want := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(signature))
}

func (s *SpacesService) processNotionEvent(ctx context.Context, event notionWebhookEvent, raw []byte) error {
	resourceID := event.Entity.ID
	resources, err := s.database.MatchingProviderResources(ctx, "notion", event.WorkspaceID, resourceID)
	if err != nil {
		return err
	}
	if len(resources) == 0 && event.Data.Parent.ID != "" {
		resources, err = s.database.MatchingProviderResources(ctx, "notion", event.WorkspaceID, event.Data.Parent.ID)
	}
	if err != nil {
		return err
	}
	for _, resource := range resources {
		claimed, claimErr := s.database.EnqueueProviderEvent(ctx, resource, event.ID, raw)
		if claimErr != nil || !claimed {
			continue
		}
		state := "processed"
		if err := s.fetchAndStoreNotionEntity(ctx, resource, event, raw); err != nil {
			state = "failed"
		} else {
			_, _ = s.ProcessProviderEvent(ctx, resource, event.ID, providerPayloadFingerprint(raw), json.RawMessage(raw))
		}
		_ = s.database.FinishProviderEvent(ctx, resource.IntegrationID, event.ID, state)
	}
	return nil
}

func (s *SpacesService) fetchAndStoreNotionEntity(ctx context.Context, resource db.ProviderSharedResource, event notionWebhookEvent, raw []byte) error {
	deleted := strings.HasSuffix(event.Type, ".deleted")
	var deletedAt *time.Time
	content := json.RawMessage(raw)
	displayName := resource.DisplayName
	if deleted {
		now := time.Now().UTC()
		deletedAt = &now
	} else {
		token, tokenType, err := s.providerTokenForSharedResource(ctx, resource)
		if err != nil {
			return err
		}
		entityType := event.Entity.Type
		endpoint := "https://api.notion.com/v1/pages/" + url.PathEscape(event.Entity.ID)
		switch entityType {
		case "database":
			endpoint = "https://api.notion.com/v1/databases/" + url.PathEscape(event.Entity.ID)
		case "data_source":
			endpoint = "https://api.notion.com/v1/data_sources/" + url.PathEscape(event.Entity.ID)
		}
		object, requestErr := providerJSONRequest(ctx, token, tokenType, http.MethodGet, endpoint, nil, map[string]string{"Notion-Version": "2026-03-11"})
		if requestErr != nil {
			return requestErr
		}
		combined := map[string]any{"object": json.RawMessage(object), "event_type": event.Type}
		if entityType == "page" || entityType == "block" {
			blocks, blockErr := fetchNotionBlocks(ctx, token, tokenType, event.Entity.ID, 500)
			if blockErr != nil {
				return blockErr
			}
			combined["blocks"] = blocks
		}
		content, _ = json.Marshal(combined)
		var objectValue map[string]any
		_ = json.Unmarshal(object, &objectValue)
		if title := notionObjectTitle(objectValue); title != "" {
			displayName = title
		}
	}
	occurred, _ := time.Parse(time.RFC3339Nano, event.Timestamp)
	var occurredAt *time.Time
	if !occurred.IsZero() {
		occurredAt = &occurred
	}
	return s.database.UpsertProviderContentRecord(ctx, db.ProviderContentRecord{SpaceID: resource.SpaceID, SharedResourceID: resource.ID, Provider: "notion", ExternalRecordID: event.Entity.ID, ParentExternalID: event.Data.Parent.ID, RecordType: event.Entity.Type, Fingerprint: providerPayloadFingerprint(content), DisplayName: displayName, MIMEType: "application/vnd.notion+json", OccurredAt: occurredAt, Content: content, DeletedAt: deletedAt})
}

func fetchNotionBlocks(ctx context.Context, token, tokenType, blockID string, maximum int) ([]any, error) {
	items := []any{}
	if maximum <= 0 {
		return items, nil
	}
	if err := appendNotionBlockChildren(ctx, token, tokenType, blockID, &items, maximum, 0); err != nil {
		return nil, err
	}
	return items, nil
}

// appendNotionBlockChildren preserves the parent-before-child citation order while
// bounding both total blocks and nesting depth. Notion currently limits block
// nesting, but the local depth guard prevents malformed provider data from turning
// one notification into unbounded work.
func appendNotionBlockChildren(ctx context.Context, token, tokenType, blockID string, items *[]any, maximum, depth int) error {
	if len(*items) >= maximum || depth >= 32 {
		return nil
	}
	cursor := ""
	for len(*items) < maximum {
		query := url.Values{"page_size": {"100"}}
		if cursor != "" {
			query.Set("start_cursor", cursor)
		}
		payload, err := providerJSONRequest(ctx, token, tokenType, http.MethodGet, "https://api.notion.com/v1/blocks/"+url.PathEscape(blockID)+"/children?"+query.Encode(), nil, map[string]string{"Notion-Version": "2026-03-11"})
		if err != nil {
			return err
		}
		var page struct {
			Results    []any  `json:"results"`
			HasMore    bool   `json:"has_more"`
			NextCursor string `json:"next_cursor"`
		}
		if json.Unmarshal(payload, &page) != nil {
			return errors.New("notion blocks response was invalid")
		}
		for _, result := range page.Results {
			if len(*items) >= maximum {
				break
			}
			*items = append(*items, result)
			block, ok := result.(map[string]any)
			if !ok {
				continue
			}
			hasChildren, _ := block["has_children"].(bool)
			childID, _ := block["id"].(string)
			if hasChildren && childID != "" {
				if err := appendNotionBlockChildren(ctx, token, tokenType, childID, items, maximum, depth+1); err != nil {
					return err
				}
			}
		}
		if !page.HasMore || page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}
	return nil
}

func readProviderCallbackBody(r *http.Request) ([]byte, error) {
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, providerCallbackBodyLimit+1))
	if err != nil || len(raw) > providerCallbackBodyLimit {
		return nil, errors.New("provider callback body exceeded limit")
	}
	return raw, nil
}
