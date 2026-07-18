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

type SpaceTask struct {
	ID               string          `json:"id"`
	SpaceID          string          `json:"space_id"`
	Title            string          `json:"title"`
	Notes            string          `json:"notes"`
	Status           string          `json:"status"`
	AssigneeUserID   string          `json:"assignee_user_id,omitempty"`
	DueAt            *time.Time      `json:"due_at,omitempty"`
	DueTimezone      string          `json:"due_timezone"`
	SourceRefs       json.RawMessage `json:"source_refs"`
	CreatedByUserID  string          `json:"created_by_user_id,omitempty"`
	CreatedByAgentID string          `json:"created_by_agent_id,omitempty"`
	SourceRunID      string          `json:"source_run_id,omitempty"`
	Version          int64           `json:"version"`
	CompletedAt      *time.Time      `json:"completed_at,omitempty"`
	ArchivedAt       *time.Time      `json:"archived_at,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

type SpaceTaskQuery struct {
	Status          string
	AssigneeUserID  string
	IncludeArchived bool
}

type SpaceCalendarSource struct {
	ID                 string     `json:"id"`
	SpaceID            string     `json:"space_id"`
	IntegrationID      string     `json:"integration_id"`
	ConnectedByUserID  string     `json:"connected_by_user_id"`
	Provider           string     `json:"provider"`
	ExternalCalendarID string     `json:"external_calendar_id"`
	DisplayName        string     `json:"display_name"`
	Timezone           string     `json:"timezone"`
	SyncToken          string     `json:"-"`
	WatchChannelID     string     `json:"-"`
	WatchResourceID    string     `json:"-"`
	WatchTokenHash     string     `json:"-"`
	WatchExpiresAt     *time.Time `json:"watch_expires_at,omitempty"`
	Status             string     `json:"status"`
	LastErrorCode      string     `json:"last_error_code,omitempty"`
	LastReconciledAt   *time.Time `json:"last_reconciled_at,omitempty"`
	DisabledAt         *time.Time `json:"disabled_at,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type SpaceCalendarEvent struct {
	ID                string          `json:"id"`
	SpaceID           string          `json:"space_id"`
	SourceID          string          `json:"source_id"`
	Provider          string          `json:"provider"`
	ExternalEventID   string          `json:"external_event_id"`
	Fingerprint       string          `json:"fingerprint"`
	Title             string          `json:"title"`
	Description       string          `json:"description"`
	Location          string          `json:"location"`
	MeetingURL        string          `json:"meeting_url"`
	Organizer         json.RawMessage `json:"organizer"`
	StartsAt          time.Time       `json:"starts_at"`
	EndsAt            time.Time       `json:"ends_at"`
	AllDay            bool            `json:"all_day"`
	Timezone          string          `json:"timezone"`
	Status            string          `json:"status"`
	ProviderCreatedAt *time.Time      `json:"provider_created_at,omitempty"`
	ProviderUpdatedAt *time.Time      `json:"provider_updated_at,omitempty"`
	RemovedAt         *time.Time      `json:"removed_at,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

const spaceTaskColumns = `id,space_id,title,notes,status,COALESCE(assignee_user_id,''),due_at,due_timezone,source_refs,COALESCE(created_by_user_id,''),COALESCE(created_by_agent_id,''),COALESCE(source_run_id,''),version,completed_at,archived_at,created_at,updated_at`

func scanSpaceTask(row interface{ Scan(...any) error }, out *SpaceTask) error {
	return row.Scan(&out.ID, &out.SpaceID, &out.Title, &out.Notes, &out.Status, &out.AssigneeUserID, &out.DueAt, &out.DueTimezone, &out.SourceRefs, &out.CreatedByUserID, &out.CreatedByAgentID, &out.SourceRunID, &out.Version, &out.CompletedAt, &out.ArchivedAt, &out.CreatedAt, &out.UpdatedAt)
}

func validateSpaceTask(item *SpaceTask) error {
	item.Title = strings.TrimSpace(item.Title)
	item.Notes = strings.TrimSpace(item.Notes)
	item.Status = strings.TrimSpace(item.Status)
	item.DueTimezone = strings.TrimSpace(item.DueTimezone)
	if item.DueTimezone == "" {
		item.DueTimezone = "UTC"
	}
	if len([]rune(item.Title)) < 1 || len([]rune(item.Title)) > 240 || len([]rune(item.Notes)) > 20000 {
		return ErrSpaceInvalid
	}
	switch item.Status {
	case "todo", "in_progress", "done", "canceled":
	default:
		return ErrSpaceInvalid
	}
	if _, err := time.LoadLocation(item.DueTimezone); err != nil {
		return ErrSpaceInvalid
	}
	if len(item.SourceRefs) == 0 {
		item.SourceRefs = json.RawMessage(`[]`)
	}
	var refs []any
	if json.Unmarshal(item.SourceRefs, &refs) != nil {
		return ErrSpaceInvalid
	}
	return nil
}

func (db *Database) SpaceTasks(ctx context.Context, userID, spaceID string, query SpaceTaskQuery) ([]SpaceTask, error) {
	out := []SpaceTask{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionTasksView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT `+spaceTaskColumns+` FROM space_tasks
			WHERE space_id=$1 AND ($2='' OR status=$2) AND ($3='' OR assignee_user_id=$3) AND ($4 OR archived_at IS NULL)
			ORDER BY archived_at NULLS FIRST,due_at NULLS LAST,updated_at DESC,id`, spaceID, query.Status, query.AssigneeUserID, query.IncludeArchived)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceTask
			if err := scanSpaceTask(rows, &item); err != nil {
				return err
			}
			out = append(out, item)
		}
		return rows.Err()
	})
	return out, err
}

func (db *Database) CreateSpaceTask(ctx context.Context, actorUserID string, item SpaceTask) (*SpaceTask, error) {
	if item.ID == "" {
		item.ID = "task_" + uuid.NewString()
	}
	if item.Status == "" {
		item.Status = "todo"
	}
	if item.CreatedByUserID == "" && item.CreatedByAgentID == "" {
		item.CreatedByUserID = actorUserID
	}
	if err := validateSpaceTask(&item); err != nil {
		return nil, err
	}
	out := &SpaceTask{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, actorUserID, item.SpaceID, PermissionTasksManage); err != nil {
			return err
		}
		if item.AssigneeUserID != "" {
			if _, err := requireSpaceMemberTx(ctx, tx, item.SpaceID, item.AssigneeUserID); err != nil {
				return ErrSpaceInvalid
			}
		}
		if item.CreatedByAgentID != "" {
			var allowed bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_agents WHERE id=$1 AND space_id=$2)`, item.CreatedByAgentID, item.SpaceID).Scan(&allowed); err != nil || !allowed {
				return ErrSpaceInvalid
			}
		}
		completed := item.Status == "done"
		query := `INSERT INTO space_tasks(id,space_id,title,notes,status,assignee_user_id,due_at,due_timezone,source_refs,created_by_user_id,created_by_agent_id,source_run_id,completed_at)
			VALUES($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8,$9,NULLIF($10,''),NULLIF($11,''),NULLIF($12,''),CASE WHEN $13 THEN NOW() END) RETURNING ` + spaceTaskColumns
		if err := scanSpaceTask(tx.QueryRowContext(ctx, query, item.ID, item.SpaceID, item.Title, item.Notes, item.Status, item.AssigneeUserID, item.DueAt, item.DueTimezone, item.SourceRefs, item.CreatedByUserID, item.CreatedByAgentID, item.SourceRunID, completed), out); err != nil {
			return err
		}
		_, err := recordSpaceEventTx(ctx, tx, item.SpaceID, actorUserID, "task.created", item.ID, map[string]any{"task": out})
		return err
	})
	return out, err
}

func (db *Database) UpdateSpaceTask(ctx context.Context, actorUserID string, item SpaceTask) (*SpaceTask, error) {
	if item.ID == "" || item.SpaceID == "" || item.Version < 1 {
		return nil, ErrSpaceInvalid
	}
	if err := validateSpaceTask(&item); err != nil {
		return nil, err
	}
	out := &SpaceTask{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, actorUserID, item.SpaceID, PermissionTasksManage); err != nil {
			return err
		}
		if item.AssigneeUserID != "" {
			if _, err := requireSpaceMemberTx(ctx, tx, item.SpaceID, item.AssigneeUserID); err != nil {
				return ErrSpaceInvalid
			}
		}
		query := `UPDATE space_tasks SET title=$1,notes=$2,status=$3,assignee_user_id=NULLIF($4,''),due_at=$5,due_timezone=$6,source_refs=$7,
			completed_at=CASE WHEN $3='done' THEN COALESCE(completed_at,NOW()) ELSE NULL END,version=version+1,updated_at=NOW()
			WHERE id=$8 AND space_id=$9 AND version=$10 AND archived_at IS NULL RETURNING ` + spaceTaskColumns
		err := scanSpaceTask(tx.QueryRowContext(ctx, query, item.Title, item.Notes, item.Status, item.AssigneeUserID, item.DueAt, item.DueTimezone, item.SourceRefs, item.ID, item.SpaceID, item.Version), out)
		if errors.Is(err, sql.ErrNoRows) {
			var exists bool
			if queryErr := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_tasks WHERE id=$1 AND space_id=$2)`, item.ID, item.SpaceID).Scan(&exists); queryErr != nil {
				return queryErr
			}
			if exists {
				return ErrSpaceConflict
			}
			return ErrSpaceNotFound
		}
		if err != nil {
			return err
		}
		_, err = recordSpaceEventTx(ctx, tx, item.SpaceID, actorUserID, "task.updated", item.ID, map[string]any{"task": out})
		return err
	})
	return out, err
}

func (db *Database) ArchiveSpaceTask(ctx context.Context, actorUserID, spaceID, taskID string, version int64) (*SpaceTask, error) {
	out := &SpaceTask{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, actorUserID, spaceID, PermissionTasksManage); err != nil {
			return err
		}
		err := scanSpaceTask(tx.QueryRowContext(ctx, `UPDATE space_tasks SET archived_at=NOW(),version=version+1,updated_at=NOW() WHERE id=$1 AND space_id=$2 AND version=$3 AND archived_at IS NULL RETURNING `+spaceTaskColumns, taskID, spaceID, version), out)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceConflict
		}
		if err != nil {
			return err
		}
		_, err = recordSpaceEventTx(ctx, tx, spaceID, actorUserID, "task.archived", taskID, map[string]any{"version": out.Version})
		return err
	})
	return out, err
}

const calendarSourceColumns = `id,space_id,integration_id,connected_by_user_id,provider,external_calendar_id,display_name,timezone,sync_token,watch_channel_id,watch_resource_id,watch_token_hash,watch_expires_at,status,last_error_code,last_reconciled_at,disabled_at,created_at,updated_at`

func scanCalendarSource(row interface{ Scan(...any) error }, out *SpaceCalendarSource) error {
	return row.Scan(&out.ID, &out.SpaceID, &out.IntegrationID, &out.ConnectedByUserID, &out.Provider, &out.ExternalCalendarID, &out.DisplayName, &out.Timezone, &out.SyncToken, &out.WatchChannelID, &out.WatchResourceID, &out.WatchTokenHash, &out.WatchExpiresAt, &out.Status, &out.LastErrorCode, &out.LastReconciledAt, &out.DisabledAt, &out.CreatedAt, &out.UpdatedAt)
}

func (db *Database) SpaceCalendarSources(ctx context.Context, userID, spaceID string) ([]SpaceCalendarSource, error) {
	out := []SpaceCalendarSource{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionTasksView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT `+calendarSourceColumns+` FROM space_calendar_sources WHERE space_id=$1 ORDER BY display_name,id`, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceCalendarSource
			if err := scanCalendarSource(rows, &item); err != nil {
				return err
			}
			out = append(out, item)
		}
		return rows.Err()
	})
	return out, err
}

func (db *Database) CreateSpaceCalendarSource(ctx context.Context, userID string, item SpaceCalendarSource) (*SpaceCalendarSource, error) {
	item.ID = "calendar_source_" + uuid.NewString()
	item.Provider = "google"
	item.ExternalCalendarID = strings.TrimSpace(item.ExternalCalendarID)
	item.DisplayName = strings.TrimSpace(item.DisplayName)
	item.Timezone = strings.TrimSpace(item.Timezone)
	if item.Timezone == "" {
		item.Timezone = "UTC"
	}
	if item.SpaceID == "" || item.IntegrationID == "" || item.ExternalCalendarID == "" || item.DisplayName == "" {
		return nil, ErrSpaceInvalid
	}
	if _, err := time.LoadLocation(item.Timezone); err != nil {
		return nil, ErrSpaceInvalid
	}
	out := &SpaceCalendarSource{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, item.SpaceID, PermissionIntegrationsManage); err != nil {
			return err
		}
		var valid bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_integrations WHERE id=$1 AND space_id=$2 AND connected_by_user_id=$3 AND provider='google' AND status='active')`, item.IntegrationID, item.SpaceID, userID).Scan(&valid); err != nil || !valid {
			return ErrSpaceInvalid
		}
		query := `INSERT INTO space_calendar_sources(id,space_id,integration_id,connected_by_user_id,provider,external_calendar_id,display_name,timezone)
			VALUES($1,$2,$3,$4,'google',$5,$6,$7) ON CONFLICT(space_id,integration_id,external_calendar_id) DO UPDATE SET display_name=EXCLUDED.display_name,timezone=EXCLUDED.timezone,status='pending',disabled_at=NULL,updated_at=NOW() RETURNING ` + calendarSourceColumns
		if err := scanCalendarSource(tx.QueryRowContext(ctx, query, item.ID, item.SpaceID, item.IntegrationID, userID, item.ExternalCalendarID, item.DisplayName, item.Timezone), out); err != nil {
			return err
		}
		_, err := recordSpaceEventTx(ctx, tx, item.SpaceID, userID, "calendar.source_published", out.ID, map[string]any{"source": out})
		return err
	})
	return out, err
}

func (db *Database) DisableSpaceCalendarSource(ctx context.Context, userID, spaceID, sourceID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionIntegrationsManage); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE space_calendar_sources SET status='disabled',disabled_at=NOW(),sync_token='',watch_channel_id='',watch_resource_id='',watch_token_hash='',watch_expires_at=NULL,updated_at=NOW() WHERE id=$1 AND space_id=$2`, sourceID, spaceID)
		if err != nil {
			return err
		}
		if changed, _ := result.RowsAffected(); changed != 1 {
			return ErrSpaceNotFound
		}
		_, err = recordSpaceEventTx(ctx, tx, spaceID, userID, "calendar.source_disabled", sourceID, map[string]any{})
		return err
	})
}

func (db *Database) SpaceCalendarEvents(ctx context.Context, userID, spaceID string, startsBefore, endsAfter time.Time) ([]SpaceCalendarEvent, error) {
	out := []SpaceCalendarEvent{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionTasksView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT id,space_id,source_id,provider,external_event_id,fingerprint,title,description,location,meeting_url,organizer,starts_at,ends_at,all_day,timezone,status,provider_created_at,provider_updated_at,removed_at,created_at,updated_at
			FROM space_calendar_events WHERE space_id=$1 AND starts_at<$2 AND ends_at>$3 AND removed_at IS NULL ORDER BY starts_at,id`, spaceID, startsBefore, endsAfter)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceCalendarEvent
			if err := rows.Scan(&item.ID, &item.SpaceID, &item.SourceID, &item.Provider, &item.ExternalEventID, &item.Fingerprint, &item.Title, &item.Description, &item.Location, &item.MeetingURL, &item.Organizer, &item.StartsAt, &item.EndsAt, &item.AllDay, &item.Timezone, &item.Status, &item.ProviderCreatedAt, &item.ProviderUpdatedAt, &item.RemovedAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
				return err
			}
			out = append(out, item)
		}
		return rows.Err()
	})
	return out, err
}

func (db *Database) CalendarSourceByWatchChannel(ctx context.Context, channelID string) (*SpaceCalendarSource, error) {
	out := &SpaceCalendarSource{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		return scanCalendarSource(tx.QueryRowContext(ctx, `SELECT `+calendarSourceColumns+` FROM space_calendar_sources WHERE watch_channel_id=$1 AND status IN ('active','syncing')`, channelID), out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) UpdateCalendarSourceSync(ctx context.Context, sourceID, syncToken, channelID, resourceID, tokenHash, status, errorCode string, expiresAt *time.Time) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `UPDATE space_calendar_sources SET sync_token=$1,watch_channel_id=COALESCE(NULLIF($2,''),watch_channel_id),watch_resource_id=COALESCE(NULLIF($3,''),watch_resource_id),watch_token_hash=COALESCE(NULLIF($4,''),watch_token_hash),watch_expires_at=COALESCE($5,watch_expires_at),status=$6,last_error_code=$7,last_reconciled_at=CASE WHEN $6='active' THEN NOW() ELSE last_reconciled_at END,updated_at=NOW() WHERE id=$8`, syncToken, channelID, resourceID, tokenHash, expiresAt, status, errorCode, sourceID)
		if err != nil {
			return err
		}
		if changed, _ := result.RowsAffected(); changed != 1 {
			return ErrSpaceNotFound
		}
		return nil
	})
}

func (db *Database) UpsertSpaceCalendarEvent(ctx context.Context, item SpaceCalendarEvent) error {
	if item.ID == "" {
		item.ID = "calendar_event_" + uuid.NewString()
	}
	if len(item.Organizer) == 0 {
		item.Organizer = json.RawMessage(`{}`)
	}
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO space_calendar_events(id,space_id,source_id,provider,external_event_id,fingerprint,title,description,location,meeting_url,organizer,starts_at,ends_at,all_day,timezone,status,provider_created_at,provider_updated_at,removed_at)
			VALUES($1,$2,$3,'google',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
			ON CONFLICT(source_id,external_event_id) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,title=EXCLUDED.title,description=EXCLUDED.description,location=EXCLUDED.location,meeting_url=EXCLUDED.meeting_url,organizer=EXCLUDED.organizer,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,all_day=EXCLUDED.all_day,timezone=EXCLUDED.timezone,status=EXCLUDED.status,provider_created_at=EXCLUDED.provider_created_at,provider_updated_at=EXCLUDED.provider_updated_at,removed_at=EXCLUDED.removed_at,updated_at=NOW()`, item.ID, item.SpaceID, item.SourceID, item.ExternalEventID, item.Fingerprint, item.Title, item.Description, item.Location, item.MeetingURL, item.Organizer, item.StartsAt, item.EndsAt, item.AllDay, item.Timezone, item.Status, item.ProviderCreatedAt, item.ProviderUpdatedAt, item.RemovedAt)
		return err
	})
}

func (db *Database) MarkSpaceCalendarEventRemoved(ctx context.Context, sourceID, externalEventID string, removedAt time.Time) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE space_calendar_events SET status='canceled',removed_at=$1,updated_at=NOW() WHERE source_id=$2 AND external_event_id=$3`, removedAt, sourceID, externalEventID)
		return err
	})
}

// InvalidateSpaceCalendarEvents implements Google's 410 contract: once a sync
// token is invalid, the local projection can no longer be trusted and must be
// rebuilt by a full synchronization.
func (db *Database) InvalidateSpaceCalendarEvents(ctx context.Context, sourceID string, removedAt time.Time) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE space_calendar_events SET status='canceled',removed_at=$1,updated_at=NOW() WHERE source_id=$2 AND removed_at IS NULL`, removedAt, sourceID)
		return err
	})
}

func (db *Database) CalendarSourcesNeedingReconciliation(ctx context.Context, limit int) ([]SpaceCalendarSource, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	out := []SpaceCalendarSource{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT `+calendarSourceColumns+` FROM space_calendar_sources
			WHERE status IN ('pending','active','needs_attention') AND disabled_at IS NULL AND
			(last_reconciled_at IS NULL OR last_reconciled_at<NOW()-INTERVAL '15 minutes' OR watch_expires_at IS NULL OR watch_expires_at<NOW()+INTERVAL '24 hours')
			ORDER BY COALESCE(last_reconciled_at,'epoch'),id LIMIT $1`, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceCalendarSource
			if err := scanCalendarSource(rows, &item); err != nil {
				return err
			}
			out = append(out, item)
		}
		return rows.Err()
	})
	return out, err
}
