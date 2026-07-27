package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/server/db"
)

// Notion read/write proxy.
//
// The Notion token never leaves the server: the desktop client asks Misty for
// Notion data and Misty makes the upstream call with the Space's stored
// credential. Every route is Space-scoped because that is where the credential
// and its permissions live.

const notionVersion = "2026-03-11"

// notionRequest performs one upstream call with the credential belonging to an
// explicitly selected Space resource. Members never receive the credential or
// gain a path to unselected workspace content.
func (s *SpacesService) notionRequest(
	ctx context.Context,
	resource db.ProviderSharedResource,
	method, endpoint string,
	body any,
) ([]byte, error) {
	token, tokenType, err := s.providerTokenForSharedResource(ctx, resource)
	if err != nil {
		return nil, err
	}
	return providerJSONRequest(ctx, token, tokenType, method, endpoint, body, map[string]string{"Notion-Version": notionVersion})
}

func (s *SpacesService) notionResource(
	ctx context.Context,
	userID, spaceID, externalResourceID string,
) (*db.ProviderSharedResource, error) {
	return s.database.ProviderSharedResourceForNotionEntity(
		ctx, userID, spaceID, strings.TrimSpace(externalResourceID),
	)
}

func (s *SpacesService) notionIntegrationID(ctx context.Context, userID, spaceID string) (string, error) {
	integrations, err := s.database.SpaceIntegrations(ctx, userID, spaceID)
	if err != nil {
		return "", err
	}
	for _, integration := range integrations {
		if integration.Provider == "notion" && integration.Status != "revoked" {
			return integration.ID, nil
		}
	}
	return "", db.ErrSpaceInvalid
}

// NotionStatus reports whether this Space can reach Notion. A Space with no
// Notion connection is the normal case, not an error, so the Notes pane can
// render its other sources without a failure state.
func (s *SpacesService) NotionStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		resources, err := s.database.ProviderSharedResources(r.Context(), userID, spaceID)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"connected": false})
			return
		}
		for _, resource := range resources {
			if resource.Provider == "notion" && resource.Status == "active" {
				writeJSON(w, http.StatusOK, map[string]any{
					"connected": true, "integration_id": resource.IntegrationID,
				})
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"connected": false})
	}
}

// NotionConnection removes the Space's Notion connection.
func (s *SpacesService) NotionConnection() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if r.Method != http.MethodDelete {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		integrationID, err := s.notionIntegrationID(r.Context(), userID, spaceID)
		if err != nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if err := s.database.DeleteProviderIntegration(r.Context(), userID, integrationID); err != nil {
			writeSpaceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type notionSourceOption struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	URL         string `json:"url,omitempty"`
	ParentTitle string `json:"parentTitle,omitempty"`
}

// NotionSources lists only sources already selected by the Space owner.
// Discovery lives in integration management and is owner-only.
func (s *SpacesService) NotionSources() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		resources, err := s.database.ProviderSharedResources(r.Context(), userID, spaceID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		items := []notionSourceOption{}
		for _, resource := range resources {
			if resource.Provider != "notion" || resource.Status != "active" {
				continue
			}
			kind := resource.ResourceType
			if kind == "data_source" {
				kind = "database"
			}
			items = append(items, notionSourceOption{
				ID: resource.ExternalResourceID, Kind: kind, Title: resource.DisplayName,
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"sources": items})
	}
}

func notionSourceFromObject(raw json.RawMessage) (notionSourceOption, bool) {
	var object struct {
		ID       string          `json:"id"`
		Object   string          `json:"object"`
		URL      string          `json:"url"`
		Archived bool            `json:"archived"`
		Title    json.RawMessage `json:"title"`
		Parent   struct {
			Type string `json:"type"`
		} `json:"parent"`
		Properties map[string]json.RawMessage `json:"properties"`
	}
	if json.Unmarshal(raw, &object) != nil || object.ID == "" || object.Archived {
		return notionSourceOption{}, false
	}
	kind := "page"
	if object.Object == "database" || object.Object == "data_source" {
		kind = "database"
	}
	var decoded map[string]any
	_ = json.Unmarshal(raw, &decoded)
	title := notionObjectTitle(decoded)
	if strings.TrimSpace(title) == "" {
		title = "Untitled"
	}
	return notionSourceOption{ID: object.ID, Kind: kind, Title: title, URL: object.URL, ParentTitle: object.Parent.Type}, true
}

// NotionPage proxies a single page read and its property patch.
func (s *SpacesService) NotionPage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, pageID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "pageID")
		resource, err := s.notionResource(r.Context(), userID, spaceID, pageID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		endpoint := "https://api.notion.com/v1/pages/" + url.PathEscape(pageID)
		switch r.Method {
		case http.MethodGet:
			s.proxyNotion(w, r, *resource, http.MethodGet, endpoint, nil)
		case http.MethodPatch:
			var body struct {
				Properties map[string]json.RawMessage `json:"properties"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			if len(body.Properties) == 0 {
				writeSpaceError(w, db.ErrSpaceInvalid)
				return
			}
			s.proxyNotion(w, r, *resource, http.MethodPatch, endpoint, map[string]any{"properties": body.Properties})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// NotionPageBlocks reads a page's block children, paginating to a bounded
// depth so one enormous page cannot stall the request.
func (s *SpacesService) NotionPageBlocks() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, pageID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "pageID")
		resource, err := s.notionResource(r.Context(), userID, spaceID, pageID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		blocks := []json.RawMessage{}
		cursor := ""
		for pages := 0; pages < 20; pages++ {
			endpoint := "https://api.notion.com/v1/blocks/" + url.PathEscape(pageID) + "/children?page_size=100"
			if cursor != "" {
				endpoint += "&start_cursor=" + url.QueryEscape(cursor)
			}
			raw, err := s.notionRequest(r.Context(), *resource, http.MethodGet, endpoint, nil)
			if err != nil {
				writeProviderFailure(w, err)
				return
			}
			var page struct {
				Results    []json.RawMessage `json:"results"`
				NextCursor string            `json:"next_cursor"`
				HasMore    bool              `json:"has_more"`
			}
			if json.Unmarshal(raw, &page) != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"code": "invalid_response"})
				return
			}
			blocks = append(blocks, page.Results...)
			if !page.HasMore || page.NextCursor == "" {
				break
			}
			cursor = page.NextCursor
		}
		writeJSON(w, http.StatusOK, map[string]any{"blocks": blocks})
	}
}

// NotionPages creates a page. This is a real outward write, so it is only
// reachable from an explicit user action in the client.
func (s *SpacesService) NotionPages() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		var body struct {
			Parent     json.RawMessage            `json:"parent"`
			Properties map[string]json.RawMessage `json:"properties"`
			Children   []json.RawMessage          `json:"children"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if len(body.Parent) == 0 || len(body.Properties) == 0 {
			writeSpaceError(w, db.ErrSpaceInvalid)
			return
		}
		if len(body.Children) > notionChildLimit {
			writeSpaceError(w, db.ErrSpaceInvalid)
			return
		}
		parentID := notionParentID(body.Parent)
		resource, err := s.notionResource(r.Context(), userID, spaceID, parentID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		payload := map[string]any{"parent": body.Parent, "properties": body.Properties}
		if len(body.Children) > 0 {
			payload["children"] = body.Children
		}
		raw, err := s.notionRequest(
			r.Context(), *resource, http.MethodPost, "https://api.notion.com/v1/pages", payload,
		)
		if err != nil {
			writeProviderFailure(w, err)
			return
		}
		var page struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(raw, &page) == nil && page.ID != "" {
			var object map[string]any
			_ = json.Unmarshal(raw, &object)
			content, _ := json.Marshal(map[string]any{"object": json.RawMessage(raw)})
			_ = s.database.UpsertProviderContentRecord(r.Context(), db.ProviderContentRecord{
				SpaceID: resource.SpaceID, SharedResourceID: resource.ID, Provider: "notion",
				ExternalRecordID: page.ID, ParentExternalID: parentID, RecordType: "page",
				Fingerprint: providerPayloadFingerprint(raw), DisplayName: notionObjectTitle(object),
				MIMEType: "application/vnd.notion+json", Content: content,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(raw)
	}
}

// Notion refuses an append larger than this, so the server rejects it before
// the request leaves Misty rather than surfacing an opaque 400.
const notionChildLimit = 100

// NotionBlockChildren appends blocks to an existing page.
func (s *SpacesService) NotionBlockChildren() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if r.Method != http.MethodPatch {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		spaceID, blockID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "blockID")
		resource, err := s.notionResource(r.Context(), userID, spaceID, blockID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		var body struct {
			Children []json.RawMessage `json:"children"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if len(body.Children) == 0 || len(body.Children) > notionChildLimit {
			writeSpaceError(w, db.ErrSpaceInvalid)
			return
		}
		endpoint := "https://api.notion.com/v1/blocks/" + url.PathEscape(blockID) + "/children"
		s.proxyNotion(w, r, *resource, http.MethodPatch, endpoint, map[string]any{"children": body.Children})
	}
}

// NotionDatabase reads a database's schema, which is what lets Misty refuse to
// write a property type it cannot express.
func (s *SpacesService) NotionDatabase() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, databaseID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "databaseID")
		resource, err := s.notionResource(r.Context(), userID, spaceID, databaseID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		s.proxyNotion(w, r, *resource, http.MethodGet,
			"https://api.notion.com/v1/databases/"+url.PathEscape(databaseID), nil)
	}
}

// NotionDatabaseQuery lists a database's rows as pages.
func (s *SpacesService) NotionDatabaseQuery() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		spaceID, databaseID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "databaseID")
		resource, err := s.notionResource(r.Context(), userID, spaceID, databaseID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		raw, err := s.notionRequest(r.Context(), *resource, http.MethodPost,
			"https://api.notion.com/v1/databases/"+url.PathEscape(databaseID)+"/query",
			map[string]any{"page_size": 100})
		if err != nil {
			writeProviderFailure(w, err)
			return
		}
		var page struct {
			Results []json.RawMessage `json:"results"`
		}
		if json.Unmarshal(raw, &page) != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"code": "invalid_response"})
			return
		}
		for _, row := range page.Results {
			var value struct {
				ID             string `json:"id"`
				LastEditedTime string `json:"last_edited_time"`
			}
			if json.Unmarshal(row, &value) != nil || value.ID == "" {
				continue
			}
			var object map[string]any
			_ = json.Unmarshal(row, &object)
			content, _ := json.Marshal(map[string]any{"object": json.RawMessage(row)})
			_ = s.database.UpsertProviderContentRecord(r.Context(), db.ProviderContentRecord{
				SpaceID: resource.SpaceID, SharedResourceID: resource.ID, Provider: "notion",
				ExternalRecordID: value.ID, ParentExternalID: databaseID, RecordType: "page",
				Fingerprint: providerPayloadFingerprint(row), DisplayName: notionObjectTitle(object),
				MIMEType: "application/vnd.notion+json", Content: content,
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"pages": page.Results})
	}
}

// NotionSearch searches only the indexed records beneath selected sources.
func (s *SpacesService) NotionSearch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		query := strings.TrimSpace(r.URL.Query().Get("q"))
		records, err := s.database.ProviderContentRecords(
			r.Context(), userID, spaceID, "notion", query, 50,
		)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		pages := []json.RawMessage{}
		for _, record := range records {
			if record.RecordType != "page" {
				continue
			}
			var content struct {
				Object json.RawMessage `json:"object"`
			}
			if json.Unmarshal(record.Content, &content) == nil && len(content.Object) > 0 {
				pages = append(pages, content.Object)
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"pages": pages})
	}
}

// proxyNotion performs the call and relays Notion's JSON verbatim, so the
// client sees the real object rather than a lossy re-encoding.
func (s *SpacesService) proxyNotion(
	w http.ResponseWriter,
	r *http.Request,
	resource db.ProviderSharedResource,
	method, endpoint string,
	body any,
) {
	raw, err := s.notionRequest(r.Context(), resource, method, endpoint, body)
	if err != nil {
		writeProviderFailure(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func notionParentID(raw json.RawMessage) string {
	var parent map[string]any
	if json.Unmarshal(raw, &parent) != nil {
		return ""
	}
	for _, key := range []string{"database_id", "data_source_id", "page_id"} {
		if value, _ := parent[key].(string); strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
