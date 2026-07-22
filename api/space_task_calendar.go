package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/server/db"
)

// Google Calendar-backed tasks.
//
// The product rule this file enforces: Google owns the schedule, Misty owns
// everything else, and neither silently overwrites the other. Local edits stay
// "unpublished" until someone publishes them, and a remote change to the same
// field produces a conflict the user resolves — never a lost edit.

// CreateCalendarTask creates a task bound to a Google calendar. `publish=false`
// keeps it a local draft; `true` creates the Google event straight away.
func (s *SpacesService) CreateCalendarTask() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		var body struct {
			Title            string          `json:"title"`
			Notes            string          `json:"notes"`
			Status           string          `json:"status"`
			Priority         string          `json:"priority"`
			AssigneeUserID   string          `json:"assignee_user_id"`
			CalendarSourceID string          `json:"calendar_source_id"`
			Schedule         db.TaskSchedule `json:"schedule"`
			Publish          bool            `json:"publish"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		source, err := s.calendarSource(r.Context(), userID, spaceID, body.CalendarSourceID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if err := validateTaskSchedule(&body.Schedule, source.Timezone); err != nil {
			writeSpaceError(w, err)
			return
		}
		if strings.TrimSpace(body.Title) == "" {
			body.Title = body.Schedule.Title
		}
		link := db.TaskCalendarLink{SourceID: source.ID, GoogleCalendarID: source.ExternalCalendarID}
		task, err := s.database.CreateCalendarSpaceTask(r.Context(), userID,
			db.SpaceTask{SpaceID: spaceID, Title: body.Title, Notes: body.Notes, Status: body.Status,
				Priority: body.Priority, AssigneeUserID: body.AssigneeUserID, DueTimezone: body.Schedule.Timezone,
				SourceRefs: json.RawMessage("[]")},
			body.Schedule, link)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if !body.Publish {
			writeJSON(w, http.StatusCreated, task)
			return
		}
		published, publishErr := s.publishTaskToGoogle(r.Context(), userID, spaceID, task)
		if publishErr != nil {
			// The draft survives a failed publish. Losing the user's typing
			// because Google was unreachable would be the worse outcome.
			writeJSON(w, http.StatusCreated, s.taskWithCalendarError(r.Context(), task, publishErr))
			return
		}
		writeJSON(w, http.StatusCreated, published)
	}
}

// PublishTaskToCalendar pushes a task's local schedule edits to Google.
func (s *SpacesService) PublishTaskToCalendar() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, taskID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "taskID")
		allowed, err := s.database.HasSpacePermission(r.Context(), userID, spaceID, db.PermissionTasksManage)
		if err != nil || !allowed {
			writeSpaceError(w, db.ErrSpaceForbidden)
			return
		}
		task, err := s.database.SpaceTaskByID(r.Context(), spaceID, taskID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		published, err := s.publishTaskToGoogle(r.Context(), userID, spaceID, task)
		if err != nil {
			writeProviderFailure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, published)
	}
}

// ResolveTaskCalendarConflict records the user's choice between their local
// edits and Google's version. Misty holds both until this is called, so neither
// side is lost to a background sync.
func (s *SpacesService) ResolveTaskCalendarConflict() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, taskID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "taskID")
		var body struct {
			Resolution string `json:"resolution"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		allowed, err := s.database.HasSpacePermission(r.Context(), userID, spaceID, db.PermissionTasksManage)
		if err != nil || !allowed {
			writeSpaceError(w, db.ErrSpaceForbidden)
			return
		}
		task, err := s.database.SpaceTaskByID(r.Context(), spaceID, taskID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		link := task.TaskCalendarLink()
		if link == nil {
			writeSpaceError(w, db.ErrSpaceInvalid)
			return
		}
		switch body.Resolution {
		case "publish_local":
			published, publishErr := s.publishTaskToGoogle(r.Context(), userID, spaceID, task)
			if publishErr != nil {
				writeProviderFailure(w, publishErr)
				return
			}
			writeJSON(w, http.StatusOK, published)
		case "discard_local":
			if link.Published == nil {
				writeSpaceError(w, db.ErrSpaceInvalid)
				return
			}
			restored := *link.Published
			updated, updateErr := s.database.SetSpaceTaskCalendar(r.Context(), spaceID, taskID, &restored, link, nil)
			if updateErr != nil {
				writeSpaceError(w, updateErr)
				return
			}
			writeJSON(w, http.StatusOK, updated)
		default:
			writeSpaceError(w, db.ErrSpaceInvalid)
		}
	}
}

// SyncCalendarTasks pulls Google changes into Misty's tasks. The underlying
// source sync uses Calendar's sync token when it has one and falls back to a
// full window otherwise; this handler then reconciles events onto tasks.
func (s *SpacesService) SyncCalendarTasks() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		var body struct {
			SourceID string `json:"source_id"`
		}
		_ = decodeJSON(w, r, &body)
		sources, err := s.database.SpaceCalendarSources(r.Context(), userID, spaceID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		tasks := []db.SpaceTask{}
		for index := range sources {
			source := sources[index]
			if source.Status == "disabled" || (body.SourceID != "" && source.ID != body.SourceID) {
				continue
			}
			if syncErr := s.syncGoogleCalendarSource(r.Context(), &source, true); syncErr != nil {
				_ = s.database.UpdateCalendarSourceSync(r.Context(), source.ID, "", "", "", "", "needs_attention", providerErrorCode(syncErr), nil)
				continue
			}
			reconciled, reconcileErr := s.reconcileCalendarTasks(r.Context(), spaceID, source)
			if reconcileErr != nil {
				continue
			}
			tasks = append(tasks, reconciled...)
		}
		refreshed, err := s.database.SpaceCalendarSources(r.Context(), userID, spaceID)
		if err != nil {
			refreshed = sources
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"tasks": tasks, "synced_at": time.Now().UTC().Format(time.RFC3339), "sources": refreshed,
		})
	}
}

// reconcileCalendarTasks folds the events Misty already mirrored into the tasks
// bound to the same source.
func (s *SpacesService) reconcileCalendarTasks(ctx context.Context, spaceID string, source db.SpaceCalendarSource) ([]db.SpaceTask, error) {
	tasks, err := s.database.CalendarBackedTasks(ctx, spaceID, source.ID)
	if err != nil {
		return nil, err
	}
	// A wide window keeps a task reconcilable even when its event moved far
	// from today; the per-event lookup below is what actually scopes the work.
	from, to := time.Now().UTC().AddDate(-1, 0, 0), time.Now().UTC().AddDate(2, 0, 0)
	events, err := s.database.SpaceCalendarEventsForSource(ctx, spaceID, source.ID, from, to)
	if err != nil {
		return nil, err
	}
	byExternalID := map[string]db.SpaceCalendarEvent{}
	for _, event := range events {
		byExternalID[event.ExternalEventID] = event
	}

	updated := []db.SpaceTask{}
	for _, task := range tasks {
		link, schedule := task.TaskCalendarLink(), task.TaskSchedule()
		if link == nil || schedule == nil || link.GoogleEventID == "" {
			continue
		}
		event, exists := byExternalID[link.GoogleEventID]
		if !exists {
			continue
		}
		incoming := db.TaskScheduleFromTimes(event.Title, event.Description, event.Location,
			event.StartsAt, event.EndsAt, event.AllDay, event.Timezone)
		merged, nextLink, conflicts := db.MergeGoogleSchedule(*schedule, *link, incoming)
		if event.Status == "canceled" || event.RemovedAt != nil {
			// A canceled Google event marks the task rather than deleting it:
			// silently vanishing work is never the right answer.
			if nextLink.CanceledAt == "" {
				nextLink.CanceledAt = time.Now().UTC().Format(time.RFC3339)
			}
		}
		if event.ProviderUpdatedAt != nil {
			nextLink.RemoteUpdatedAt = event.ProviderUpdatedAt.UTC().Format(time.RFC3339)
		}
		saved, saveErr := s.database.SetSpaceTaskCalendar(ctx, spaceID, task.ID, &merged, &nextLink, conflicts)
		if saveErr != nil {
			continue
		}
		updated = append(updated, *saved)
	}
	return updated, nil
}

// publishTaskToGoogle creates or patches the Google event behind a task and
// advances the published snapshot so nothing is left falsely "unpublished".
func (s *SpacesService) publishTaskToGoogle(ctx context.Context, userID, spaceID string, task *db.SpaceTask) (*db.SpaceTask, error) {
	link, schedule := task.TaskCalendarLink(), task.TaskSchedule()
	if link == nil || schedule == nil {
		return nil, db.ErrSpaceInvalid
	}
	source, err := s.calendarSource(ctx, userID, spaceID, link.SourceID)
	if err != nil {
		return nil, err
	}
	token, tokenType, err := s.providerAccessToken(ctx, source.ConnectedByUserID, spaceID, source.IntegrationID)
	if err != nil {
		return nil, err
	}
	payload := googleEventPayload(*schedule)
	endpoint := "https://www.googleapis.com/calendar/v3/calendars/" + url.PathEscape(source.ExternalCalendarID) + "/events"
	method := http.MethodPost
	if link.GoogleEventID != "" {
		endpoint += "/" + url.PathEscape(link.GoogleEventID)
		method = http.MethodPatch
	}
	raw, err := googleCalendarRequest(ctx, token, tokenType, method, endpoint, payload)
	if err != nil {
		return nil, err
	}
	var event googleCalendarEvent
	if json.Unmarshal(raw, &event) != nil || event.ID == "" {
		return nil, errors.New("google calendar event response was invalid")
	}
	published := *schedule
	link.GoogleEventID = event.ID
	link.Published = &published
	link.PublishedAt = event.Updated
	link.RemoteUpdatedAt = event.Updated
	link.LastErrorCode = ""
	if event.Status != "cancelled" {
		link.CanceledAt = ""
	}
	return s.database.SetSpaceTaskCalendar(ctx, spaceID, task.ID, schedule, link, nil)
}

// googleEventPayload shapes a schedule for Google.
//
// Google's all-day `end.date` is exclusive, so a single-day task must send the
// following day or the event renders as zero-length.
func googleEventPayload(schedule db.TaskSchedule) map[string]any {
	summary := strings.TrimSpace(schedule.Title)
	if summary == "" {
		summary = "Untitled"
	}
	payload := map[string]any{
		"summary": summary, "description": schedule.Description, "location": schedule.Location,
	}
	if schedule.AllDay {
		start := dateOnly(schedule.StartsAt)
		end := dateOnly(schedule.EndsAt)
		if end == "" || end == start {
			end = nextCalendarDay(start)
		}
		payload["start"] = map[string]any{"date": start}
		payload["end"] = map[string]any{"date": end}
		return payload
	}
	endsAt := schedule.EndsAt
	if strings.TrimSpace(endsAt) == "" {
		endsAt = schedule.StartsAt
	}
	payload["start"] = map[string]any{"dateTime": schedule.StartsAt, "timeZone": schedule.Timezone}
	payload["end"] = map[string]any{"dateTime": endsAt, "timeZone": schedule.Timezone}
	return payload
}

func dateOnly(value string) string {
	value = strings.TrimSpace(value)
	if len(value) == 10 {
		return value
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed.UTC().Format("2006-01-02")
	}
	return value
}

func nextCalendarDay(date string) string {
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	return parsed.AddDate(0, 0, 1).Format("2006-01-02")
}

// validateTaskSchedule rejects a schedule Google would refuse, before any write
// leaves Misty.
func validateTaskSchedule(schedule *db.TaskSchedule, fallbackTimezone string) error {
	schedule.Title = strings.TrimSpace(schedule.Title)
	schedule.Timezone = strings.TrimSpace(schedule.Timezone)
	if schedule.Timezone == "" {
		schedule.Timezone = fallbackTimezone
	}
	if schedule.Timezone == "" {
		schedule.Timezone = "UTC"
	}
	if _, err := time.LoadLocation(schedule.Timezone); err != nil {
		return db.ErrSpaceInvalid
	}
	if len([]rune(schedule.Title)) > 240 || len([]rune(schedule.Description)) > 20000 {
		return db.ErrSpaceInvalid
	}
	layout := time.RFC3339
	if schedule.AllDay {
		layout = "2006-01-02"
	}
	startsAt, startErr := time.Parse(layout, strings.TrimSpace(schedule.StartsAt))
	if startErr != nil {
		return db.ErrSpaceInvalid
	}
	if strings.TrimSpace(schedule.EndsAt) == "" {
		schedule.EndsAt = schedule.StartsAt
		return nil
	}
	endsAt, endErr := time.Parse(layout, strings.TrimSpace(schedule.EndsAt))
	if endErr != nil || endsAt.Before(startsAt) {
		return db.ErrSpaceInvalid
	}
	return nil
}

func (s *SpacesService) calendarSource(ctx context.Context, userID, spaceID, sourceID string) (db.SpaceCalendarSource, error) {
	sources, err := s.database.SpaceCalendarSources(ctx, userID, spaceID)
	if err != nil {
		return db.SpaceCalendarSource{}, err
	}
	for _, source := range sources {
		if source.ID == sourceID {
			return source, nil
		}
	}
	return db.SpaceCalendarSource{}, db.ErrSpaceInvalid
}

// taskWithCalendarError records why a publish failed without discarding the
// task, so the board can show "needs attention" instead of losing the draft.
func (s *SpacesService) taskWithCalendarError(ctx context.Context, task *db.SpaceTask, cause error) *db.SpaceTask {
	link, schedule := task.TaskCalendarLink(), task.TaskSchedule()
	if link == nil || schedule == nil {
		return task
	}
	link.LastErrorCode = providerErrorCode(cause)
	updated, err := s.database.SetSpaceTaskCalendar(ctx, task.SpaceID, task.ID, schedule, link, task.ConflictedFields)
	if err != nil {
		return task
	}
	return updated
}
