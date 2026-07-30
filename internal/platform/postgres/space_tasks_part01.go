package db

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

type SpaceTask struct {
	ID               string          `json:"id"`
	SpaceID          string          `json:"space_id"`
	TaskNumber       int64           `json:"task_number"`
	TaskKey          string          `json:"task_key"`
	Title            string          `json:"title"`
	Notes            string          `json:"notes"`
	Status           string          `json:"status"`
	Priority         string          `json:"priority"`
	Rank             int64           `json:"rank"`
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
	// Google Calendar state. All three stay empty for Misty-only tasks.
	Schedule         json.RawMessage `json:"schedule,omitempty"`
	Calendar         json.RawMessage `json:"calendar,omitempty"`
	ConflictedFields []string        `json:"conflicted_fields,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

type SpaceTaskQuery struct {
	Status          string
	AssigneeUserID  string
	Priority        string
	Search          string
	DueFrom         *time.Time
	DueTo           *time.Time
	Sort            string
	Cursor          string
	Limit           int
	IncludeArchived bool
}

type SpaceTaskPage struct {
	Tasks        []SpaceTask      `json:"tasks"`
	NextCursor   string           `json:"next_cursor,omitempty"`
	StatusTotals map[string]int64 `json:"status_totals"`
}

type SpaceTaskMove struct {
	Version      int64  `json:"version"`
	Status       string `json:"status"`
	BeforeTaskID string `json:"before_task_id,omitempty"`
}

type SpaceTaskMoveResult struct {
	Task      SpaceTask   `json:"task"`
	Reordered []SpaceTask `json:"reordered"`
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

const spaceTaskColumns = `id,space_id,task_number,task_key,title,notes,status,priority,rank,COALESCE(assignee_user_id,''),due_at,due_timezone,source_refs,COALESCE(created_by_user_id,''),COALESCE(created_by_agent_id,''),COALESCE(source_run_id,''),version,completed_at,archived_at,created_at,updated_at,schedule,calendar,conflicted_fields`

func scanSpaceTask(row interface{ Scan(...any) error }, out *SpaceTask) error {
	var schedule, calendar []byte
	var conflicts pq.StringArray
	if err := row.Scan(&out.ID, &out.SpaceID, &out.TaskNumber, &out.TaskKey, &out.Title, &out.Notes, &out.Status, &out.Priority, &out.Rank, &out.AssigneeUserID, &out.DueAt, &out.DueTimezone, &out.SourceRefs, &out.CreatedByUserID, &out.CreatedByAgentID, &out.SourceRunID, &out.Version, &out.CompletedAt, &out.ArchivedAt, &out.CreatedAt, &out.UpdatedAt, &schedule, &calendar, &conflicts); err != nil {
		return err
	}
	if len(schedule) > 0 {
		out.Schedule = append(json.RawMessage(nil), schedule...)
	}
	if len(calendar) > 0 {
		out.Calendar = append(json.RawMessage(nil), calendar...)
	}
	out.ConflictedFields = conflicts
	return nil
}

func validateSpaceTask(item *SpaceTask) error {
	item.Title = strings.TrimSpace(item.Title)
	item.Notes = strings.TrimSpace(item.Notes)
	item.Status = strings.TrimSpace(item.Status)
	item.Priority = strings.TrimSpace(item.Priority)
	item.DueTimezone = strings.TrimSpace(item.DueTimezone)
	if item.Priority == "" {
		item.Priority = "medium"
	}
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
	switch item.Priority {
	case "high", "medium", "low":
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
	page, err := db.SpaceTaskPage(ctx, userID, spaceID, query)
	return page.Tasks, err
}

func (db *Database) SpaceTaskPage(ctx context.Context, userID, spaceID string, query SpaceTaskQuery) (SpaceTaskPage, error) {
	out := SpaceTaskPage{Tasks: []SpaceTask{}, StatusTotals: map[string]int64{"todo": 0, "in_progress": 0, "done": 0, "canceled": 0}}
	if query.Limit < 1 || query.Limit > 200 {
		query.Limit = 100
	}
	offset, err := decodeTaskCursor(query.Cursor)
	if err != nil {
		return out, ErrSpaceInvalid
	}
	query.Status, query.AssigneeUserID, query.Priority, query.Search = strings.TrimSpace(query.Status), strings.TrimSpace(query.AssigneeUserID), strings.TrimSpace(query.Priority), strings.TrimSpace(query.Search)
	if query.Priority != "" && query.Priority != "high" && query.Priority != "medium" && query.Priority != "low" {
		return out, ErrSpaceInvalid
	}
	order := `status,rank,id`
	switch query.Sort {
	case "", "rank":
	case "due":
		order = `due_at NULLS LAST,updated_at DESC,id`
	case "updated":
		order = `updated_at DESC,id`
	default:
		return out, ErrSpaceInvalid
	}
	err = db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionTasksView); err != nil {
			return err
		}
		filters := `space_id=$1 AND ($2='' OR status=$2) AND ($3='' OR assignee_user_id=$3) AND ($4='' OR priority=$4) AND ($5='' OR title ILIKE '%'||$5||'%' OR notes ILIKE '%'||$5||'%' OR task_key ILIKE '%'||$5||'%') AND ($6::timestamptz IS NULL OR due_at >= $6) AND ($7::timestamptz IS NULL OR due_at < $7) AND ($8 OR archived_at IS NULL)`
		rows, err := tx.QueryContext(ctx, `SELECT `+spaceTaskColumns+` FROM space_tasks WHERE `+filters+` ORDER BY `+order+` LIMIT $9 OFFSET $10`, spaceID, query.Status, query.AssigneeUserID, query.Priority, query.Search, query.DueFrom, query.DueTo, query.IncludeArchived, query.Limit+1, offset)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceTask
			if err := scanSpaceTask(rows, &item); err != nil {
				return err
			}
			out.Tasks = append(out.Tasks, item)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		if len(out.Tasks) > query.Limit {
			out.Tasks = out.Tasks[:query.Limit]
			out.NextCursor = encodeTaskCursor(offset + query.Limit)
		}
		countRows, err := tx.QueryContext(ctx, `SELECT status,COUNT(*) FROM space_tasks WHERE space_id=$1 AND archived_at IS NULL GROUP BY status`, spaceID)
		if err != nil {
			return err
		}
		defer countRows.Close()
		for countRows.Next() {
			var status string
			var total int64
			if err := countRows.Scan(&status, &total); err != nil {
				return err
			}
			out.StatusTotals[status] = total
		}
		return countRows.Err()
	})
	return out, err
}

func encodeTaskCursor(offset int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset)))
}
