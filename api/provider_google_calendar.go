package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/server/db"
)

type googleCalendarMetadata struct {
	ID       string `json:"id"`
	Summary  string `json:"summary"`
	Timezone string `json:"timeZone"`
	Primary  bool   `json:"primary"`
	Access   string `json:"accessRole"`
}

type googleAPIError struct {
	Status int
	Body   string
}

func (e *googleAPIError) Error() string { return fmt.Sprintf("google calendar returned %d", e.Status) }

func (s *SpacesService) AvailableGoogleCalendars() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		allowed, err := s.database.HasSpacePermission(r.Context(), userID, spaceID, db.PermissionIntegrationsManage)
		if err != nil || !allowed {
			writeSpaceError(w, db.ErrSpaceForbidden)
			return
		}
		connectionID := strings.TrimSpace(r.URL.Query().Get("integration_id"))
		items, err := s.listGoogleCalendars(r.Context(), userID, spaceID, connectionID)
		if err != nil {
			writeProviderFailure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"calendars": items})
	}
}

func (s *SpacesService) listGoogleCalendars(ctx context.Context, userID, spaceID, integrationID string) ([]googleCalendarMetadata, error) {
	token, tokenType, err := s.providerAccessToken(ctx, userID, spaceID, integrationID)
	if err != nil {
		return nil, err
	}
	items := []googleCalendarMetadata{}
	pageToken := ""
	for pages := 0; pages < 20; pages++ {
		values := url.Values{"maxResults": {"250"}, "showDeleted": {"false"}}
		if pageToken != "" {
			values.Set("pageToken", pageToken)
		}
		payload, err := googleCalendarRequest(ctx, token, tokenType, http.MethodGet, "https://www.googleapis.com/calendar/v3/users/me/calendarList?"+values.Encode(), nil)
		if err != nil {
			return nil, err
		}
		var page struct {
			Items         []googleCalendarMetadata `json:"items"`
			NextPageToken string                   `json:"nextPageToken"`
		}
		if json.Unmarshal(payload, &page) != nil {
			return nil, errors.New("google calendar list response was invalid")
		}
		for _, item := range page.Items {
			if item.ID == "" || item.Access == "freeBusyReader" {
				continue
			}
			if item.Timezone == "" {
				item.Timezone = "UTC"
			}
			items = append(items, item)
		}
		if page.NextPageToken == "" {
			break
		}
		pageToken = page.NextPageToken
	}
	return items, nil
}

func (s *SpacesService) googleCalendarMetadata(ctx context.Context, userID, spaceID, integrationID, calendarID string) (googleCalendarMetadata, error) {
	calendarID = strings.TrimSpace(calendarID)
	if calendarID == "" {
		return googleCalendarMetadata{}, db.ErrSpaceInvalid
	}
	items, err := s.listGoogleCalendars(ctx, userID, spaceID, integrationID)
	if err != nil {
		return googleCalendarMetadata{}, err
	}
	for _, item := range items {
		if item.ID == calendarID {
			return item, nil
		}
	}
	return googleCalendarMetadata{}, db.ErrSpaceInvalid
}

type googleEventTime struct {
	Date     string `json:"date"`
	DateTime string `json:"dateTime"`
	Timezone string `json:"timeZone"`
}

type googleCalendarEvent struct {
	ID          string          `json:"id"`
	Status      string          `json:"status"`
	Summary     string          `json:"summary"`
	Description string          `json:"description"`
	Location    string          `json:"location"`
	HTMLLink    string          `json:"htmlLink"`
	HangoutLink string          `json:"hangoutLink"`
	Organizer   json.RawMessage `json:"organizer"`
	Start       googleEventTime `json:"start"`
	End         googleEventTime `json:"end"`
	Created     string          `json:"created"`
	Updated     string          `json:"updated"`
}

func (s *SpacesService) syncGoogleCalendarSource(ctx context.Context, source *db.SpaceCalendarSource, ensureWatch bool) error {
	if source == nil || source.Status == "disabled" {
		return db.ErrSpaceInvalid
	}
	token, tokenType, err := s.providerAccessToken(ctx, source.ConnectedByUserID, source.SpaceID, source.IntegrationID)
	if err != nil {
		return err
	}
	incremental := source.SyncToken != ""
	syncToken, pageToken := source.SyncToken, ""
	finished := false
	for pages := 0; pages < 100; pages++ {
		values := url.Values{"maxResults": {"2500"}, "showDeleted": {"true"}, "singleEvents": {"true"}}
		if syncToken != "" {
			values.Set("syncToken", syncToken)
		}
		if pageToken != "" {
			values.Set("pageToken", pageToken)
		}
		endpoint := "https://www.googleapis.com/calendar/v3/calendars/" + url.PathEscape(source.ExternalCalendarID) + "/events?" + values.Encode()
		payload, requestErr := googleCalendarRequest(ctx, token, tokenType, http.MethodGet, endpoint, nil)
		var apiErr *googleAPIError
		if errors.As(requestErr, &apiErr) && apiErr.Status == http.StatusGone && syncToken != "" {
			if err := s.database.InvalidateSpaceCalendarEvents(ctx, source.ID, time.Now().UTC()); err != nil {
				return err
			}
			syncToken, pageToken, incremental = "", "", false
			continue
		}
		if requestErr != nil {
			return requestErr
		}
		var page struct {
			Items         []googleCalendarEvent `json:"items"`
			NextPageToken string                `json:"nextPageToken"`
			NextSyncToken string                `json:"nextSyncToken"`
		}
		if json.Unmarshal(payload, &page) != nil {
			return errors.New("google calendar events response was invalid")
		}
		for _, event := range page.Items {
			if event.ID == "" {
				continue
			}
			startsAt, endsAt, allDay, timezone, timeErr := parseGoogleEventTimes(event.Start, event.End, source.Timezone)
			if timeErr != nil {
				if event.Status == "cancelled" {
					_ = s.database.MarkSpaceCalendarEventRemoved(ctx, source.ID, event.ID, time.Now().UTC())
					if incremental {
						raw, _ := json.Marshal(event)
						fingerprint := sha256.Sum256(raw)
						_, _ = s.ProcessNormalizedProviderEvent(ctx, source.SpaceID, "google", source.ExternalCalendarID, source.DisplayName, event.ID+":"+hex.EncodeToString(fingerprint[:8]), hex.EncodeToString(fingerprint[:]), event)
					}
					continue
				}
				return timeErr
			}
			status := event.Status
			if status == "cancelled" {
				status = "canceled"
			}
			if status != "confirmed" && status != "tentative" && status != "canceled" {
				status = "confirmed"
			}
			fingerprintBytes, _ := json.Marshal(event)
			fingerprint := sha256.Sum256(fingerprintBytes)
			meetingURL := event.HangoutLink
			if meetingURL == "" && strings.HasPrefix(event.HTMLLink, "https://") {
				meetingURL = event.HTMLLink
			}
			createdAt, _ := time.Parse(time.RFC3339Nano, event.Created)
			updatedAt, _ := time.Parse(time.RFC3339Nano, event.Updated)
			var providerCreated, providerUpdated *time.Time
			if !createdAt.IsZero() {
				value := createdAt.UTC()
				providerCreated = &value
			}
			if !updatedAt.IsZero() {
				value := updatedAt.UTC()
				providerUpdated = &value
			}
			if err := s.database.UpsertSpaceCalendarEvent(ctx, db.SpaceCalendarEvent{SpaceID: source.SpaceID, SourceID: source.ID, ExternalEventID: event.ID, Fingerprint: hex.EncodeToString(fingerprint[:]), Title: event.Summary, Description: event.Description, Location: event.Location, MeetingURL: meetingURL, Organizer: event.Organizer, StartsAt: startsAt, EndsAt: endsAt, AllDay: allDay, Timezone: timezone, Status: status, ProviderCreatedAt: providerCreated, ProviderUpdatedAt: providerUpdated}); err != nil {
				return err
			}
			if incremental {
				eventID := event.ID + ":" + hex.EncodeToString(fingerprint[:8])
				_, _ = s.ProcessNormalizedProviderEvent(ctx, source.SpaceID, "google", source.ExternalCalendarID, source.DisplayName, eventID, hex.EncodeToString(fingerprint[:]), event)
			}
		}
		if page.NextPageToken != "" {
			pageToken = page.NextPageToken
			continue
		}
		if page.NextSyncToken == "" {
			return errors.New("google calendar did not return a sync token")
		}
		syncToken = page.NextSyncToken
		finished = true
		break
	}
	if !finished {
		return errors.New("google calendar synchronization exceeded the page limit")
	}
	if err := s.database.UpdateCalendarSourceSync(ctx, source.ID, syncToken, "", "", "", "active", "", nil); err != nil {
		return err
	}
	if ensureWatch && (source.WatchExpiresAt == nil || source.WatchExpiresAt.Before(time.Now().UTC().Add(24*time.Hour))) {
		return s.createGoogleCalendarWatch(ctx, source, token, tokenType, syncToken)
	}
	return nil
}

func parseGoogleEventTimes(start, end googleEventTime, fallbackTimezone string) (time.Time, time.Time, bool, string, error) {
	timezone := start.Timezone
	if timezone == "" {
		timezone = fallbackTimezone
	}
	if timezone == "" {
		timezone = "UTC"
	}
	if start.DateTime != "" && end.DateTime != "" {
		startsAt, startErr := time.Parse(time.RFC3339, start.DateTime)
		endsAt, endErr := time.Parse(time.RFC3339, end.DateTime)
		if startErr != nil || endErr != nil || endsAt.Before(startsAt) {
			return time.Time{}, time.Time{}, false, timezone, errors.New("google calendar event time was invalid")
		}
		return startsAt.UTC(), endsAt.UTC(), false, timezone, nil
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		location = time.UTC
		timezone = "UTC"
	}
	startsAt, startErr := time.ParseInLocation("2006-01-02", start.Date, location)
	endsAt, endErr := time.ParseInLocation("2006-01-02", end.Date, location)
	if startErr != nil || endErr != nil || endsAt.Before(startsAt) {
		return time.Time{}, time.Time{}, true, timezone, errors.New("google calendar all-day event was invalid")
	}
	return startsAt.UTC(), endsAt.UTC(), true, timezone, nil
}

func (s *SpacesService) createGoogleCalendarWatch(ctx context.Context, source *db.SpaceCalendarSource, token, tokenType, syncToken string) error {
	channelID, channelToken := "gcal_"+randomProviderValue(24), randomProviderValue(32)
	expiresAt := time.Now().UTC().Add(6 * 24 * time.Hour)
	body := map[string]any{"id": channelID, "type": "web_hook", "address": providerInfrastructureURL("google", "calendar"), "token": channelToken, "expiration": expiresAt.UnixMilli()}
	endpoint := "https://www.googleapis.com/calendar/v3/calendars/" + url.PathEscape(source.ExternalCalendarID) + "/events/watch"
	payload, err := googleCalendarRequest(ctx, token, tokenType, http.MethodPost, endpoint, body)
	if err != nil {
		return err
	}
	var response struct {
		ID         string `json:"id"`
		ResourceID string `json:"resourceId"`
		Expiration string `json:"expiration"`
	}
	if json.Unmarshal(payload, &response) != nil || response.ID == "" || response.ResourceID == "" {
		return errors.New("google calendar watch response was invalid")
	}
	if milliseconds, parseErr := strconv.ParseInt(response.Expiration, 10, 64); parseErr == nil && milliseconds > 0 {
		expiresAt = time.UnixMilli(milliseconds).UTC()
	}
	return s.database.UpdateCalendarSourceSync(ctx, source.ID, syncToken, response.ID, response.ResourceID, hashProviderValue(channelToken), "active", "", &expiresAt)
}

func (s *SpacesService) GoogleCalendarCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		channelID, channelToken := r.Header.Get("X-Goog-Channel-ID"), r.Header.Get("X-Goog-Channel-Token")
		resourceID := r.Header.Get("X-Goog-Resource-ID")
		if channelID == "" || channelToken == "" || resourceID == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		source, err := s.database.CalendarSourceByWatchChannel(r.Context(), channelID)
		if err != nil || source.WatchTokenHash == "" || source.WatchTokenHash != hashProviderValue(channelToken) || source.WatchResourceID != resourceID {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		go func(item *db.SpaceCalendarSource) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			if syncErr := s.syncGoogleCalendarSource(ctx, item, false); syncErr != nil {
				_ = s.database.UpdateCalendarSourceSync(ctx, item.ID, item.SyncToken, "", "", "", "needs_attention", providerErrorCode(syncErr), nil)
			}
		}(source)
	}
}

func (s *SpacesService) ReconcileGoogleCalendars(ctx context.Context, limit int) (int, error) {
	sources, err := s.database.CalendarSourcesNeedingReconciliation(ctx, limit)
	if err != nil {
		return 0, err
	}
	completed := 0
	for index := range sources {
		if err := s.syncGoogleCalendarSource(ctx, &sources[index], true); err != nil {
			_ = s.database.UpdateCalendarSourceSync(ctx, sources[index].ID, sources[index].SyncToken, "", "", "", "needs_attention", providerErrorCode(err), nil)
			continue
		}
		completed++
	}
	return completed, nil
}

func googleCalendarRequest(ctx context.Context, token, tokenType, method, endpoint string, body any) ([]byte, error) {
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
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	payload, readErr := io.ReadAll(io.LimitReader(response.Body, 4<<20+1))
	if readErr != nil {
		return nil, readErr
	}
	if len(payload) > 4<<20 {
		return nil, errors.New("google calendar response exceeded 4 MiB")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return payload, &googleAPIError{Status: response.StatusCode, Body: string(payload)}
	}
	return payload, nil
}

func providerInfrastructureURL(parts ...string) string {
	base := configuredPublicAPIBase()
	if base == "" {
		base = "http://127.0.0.1:8080/api"
	}
	escaped := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			escaped = append(escaped, url.PathEscape(part))
		}
	}
	return base + "/provider-callbacks/" + strings.Join(escaped, "/")
}

func providerErrorCode(err error) string {
	var apiErr *googleAPIError
	if errors.As(err, &apiErr) {
		switch apiErr.Status {
		case http.StatusUnauthorized:
			return "connection_revoked"
		case http.StatusForbidden:
			return "permission_missing"
		case http.StatusTooManyRequests:
			return "rate_limited"
		case http.StatusGone:
			return "cursor_expired"
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "provider_timeout"
	}
	return "provider_unavailable"
}

func writeProviderFailure(w http.ResponseWriter, err error) {
	var apiErr *googleAPIError
	if errors.As(err, &apiErr) {
		status := http.StatusBadGateway
		if apiErr.Status == http.StatusUnauthorized || apiErr.Status == http.StatusForbidden {
			status = http.StatusFailedDependency
		}
		writeJSON(w, status, map[string]string{"code": providerErrorCode(err)})
		return
	}
	writeSpaceError(w, err)
}
