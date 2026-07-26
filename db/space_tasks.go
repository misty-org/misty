package db

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
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

func decodeTaskCursor(cursor string) (int, error) {
	if cursor == "" {
		return 0, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return 0, err
	}
	offset, err := strconv.Atoi(string(raw))
	if err != nil || offset < 0 || offset > 1_000_000 {
		return 0, ErrSpaceInvalid
	}
	return offset, nil
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
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "space-task-rank:"+item.SpaceID+":"+item.Status); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_task_counters(space_id,last_number) VALUES($1,1)
			ON CONFLICT(space_id) DO UPDATE SET last_number=space_task_counters.last_number+1 RETURNING last_number`, item.SpaceID).Scan(&item.TaskNumber); err != nil {
			return err
		}
		item.TaskKey = fmt.Sprintf("MST-%d", item.TaskNumber)
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(rank),0)+1024 FROM space_tasks WHERE space_id=$1 AND status=$2 AND archived_at IS NULL`, item.SpaceID, item.Status).Scan(&item.Rank); err != nil {
			return err
		}
		completed := item.Status == "done"
		query := `INSERT INTO space_tasks(id,space_id,task_number,task_key,title,notes,status,priority,rank,assignee_user_id,due_at,due_timezone,source_refs,created_by_user_id,created_by_agent_id,source_run_id,completed_at)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,''),$11,$12,$13,NULLIF($14,''),NULLIF($15,''),NULLIF($16,''),CASE WHEN $17 THEN NOW() END) RETURNING ` + spaceTaskColumns
		if err := scanSpaceTask(tx.QueryRowContext(ctx, query, item.ID, item.SpaceID, item.TaskNumber, item.TaskKey, item.Title, item.Notes, item.Status, item.Priority, item.Rank, item.AssigneeUserID, item.DueAt, item.DueTimezone, item.SourceRefs, item.CreatedByUserID, item.CreatedByAgentID, item.SourceRunID, completed), out); err != nil {
			return err
		}
		_, err := recordSpaceEventTx(ctx, tx, item.SpaceID, actorUserID, "task.created", item.ID, map[string]any{"task": out})
		return err
	})
	return out, err
}

// lockActiveSpaceTaskTx takes the row lock that establishes server-receipt
// order for concurrent writes to one task. Lock acquisition order is the
// authoritative ordering: whichever transaction acquires the lock last writes
// last and wins.
//
// An archived task is a tombstone. It reports not-found so a stale in-flight
// write cannot resurrect it.
func lockActiveSpaceTaskTx(ctx context.Context, tx *sql.Tx, spaceID, taskID string) error {
	var archivedAt sql.NullTime
	err := tx.QueryRowContext(ctx,
		`SELECT archived_at FROM space_tasks WHERE id=$1 AND space_id=$2 FOR UPDATE`,
		taskID, spaceID).Scan(&archivedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrSpaceNotFound
	}
	if err != nil {
		return err
	}
	if archivedAt.Valid {
		return ErrSpaceNotFound
	}
	return nil
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
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "space-task-rank:"+item.SpaceID+":"+item.Status); err != nil {
			return err
		}
		// Active tasks are last-write-wins: the row lock below, not the client's
		// submitted version, decides the order of concurrent writes. The
		// submitted version is still accepted for wire compatibility.
		if err := lockActiveSpaceTaskTx(ctx, tx, item.SpaceID, item.ID); err != nil {
			return err
		}
		query := `UPDATE space_tasks SET title=$1,notes=$2,status=$3,priority=$4,assignee_user_id=NULLIF($5,''),due_at=$6,due_timezone=$7,source_refs=$8,
			rank=CASE WHEN status<>$3 THEN (SELECT COALESCE(MAX(other.rank),0)+1024 FROM space_tasks other WHERE other.space_id=$10 AND other.status=$3 AND other.archived_at IS NULL) ELSE rank END,
			completed_at=CASE WHEN $3='done' THEN COALESCE(completed_at,NOW()) ELSE NULL END,version=version+1,updated_at=NOW()
			WHERE id=$9 AND space_id=$10 AND archived_at IS NULL RETURNING ` + spaceTaskColumns
		err := scanSpaceTask(tx.QueryRowContext(ctx, query, item.Title, item.Notes, item.Status, item.Priority, item.AssigneeUserID, item.DueAt, item.DueTimezone, item.SourceRefs, item.ID, item.SpaceID), out)
		if errors.Is(err, sql.ErrNoRows) {
			// The archived_at guard above means the row was archived between the
			// lock and the write. A tombstone must never be resurrected.
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

func (db *Database) MoveSpaceTask(ctx context.Context, actorUserID, spaceID, taskID string, move SpaceTaskMove) (*SpaceTaskMoveResult, error) {
	if taskID == "" || move.Version < 1 || move.Status != "todo" && move.Status != "in_progress" && move.Status != "done" && move.Status != "canceled" {
		return nil, ErrSpaceInvalid
	}
	result := &SpaceTaskMoveResult{Reordered: []SpaceTask{}}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, actorUserID, spaceID, PermissionTasksManage); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "space-task-rank:"+spaceID+":"+move.Status); err != nil {
			return err
		}
		// The row lock decides which of two concurrent moves is last, so the
		// client's submitted version is not part of the predicate.
		if err := lockActiveSpaceTaskTx(ctx, tx, spaceID, taskID); err != nil {
			return err
		}
		newRank, err := taskRankBefore(ctx, tx, spaceID, taskID, move.Status, move.BeforeTaskID)
		if err != nil {
			return err
		}
		if newRank == 0 {
			if err := rebalanceTaskColumn(ctx, tx, spaceID, move.Status, taskID); err != nil {
				return err
			}
			newRank, err = taskRankBefore(ctx, tx, spaceID, taskID, move.Status, move.BeforeTaskID)
			if err != nil || newRank == 0 {
				return ErrSpaceConflict
			}
		}
		completed := move.Status == "done"
		err = scanSpaceTask(tx.QueryRowContext(ctx, `UPDATE space_tasks SET status=$1,rank=$2,completed_at=CASE WHEN $3 THEN COALESCE(completed_at,NOW()) ELSE NULL END,version=version+1,updated_at=NOW() WHERE id=$4 AND space_id=$5 AND archived_at IS NULL RETURNING `+spaceTaskColumns, move.Status, newRank, completed, taskID, spaceID), &result.Task)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrSpaceNotFound
		}
		if err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT `+spaceTaskColumns+` FROM space_tasks WHERE space_id=$1 AND status=$2 AND archived_at IS NULL ORDER BY rank,id`, spaceID, move.Status)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var task SpaceTask
			if err := scanSpaceTask(rows, &task); err != nil {
				return err
			}
			result.Reordered = append(result.Reordered, task)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		_, err = recordSpaceEventTx(ctx, tx, spaceID, actorUserID, "task.moved", taskID, map[string]any{"task": result.Task})
		return err
	})
	return result, err
}

func taskRankBefore(ctx context.Context, tx *sql.Tx, spaceID, taskID, status, beforeTaskID string) (int64, error) {
	if beforeTaskID == "" {
		var maxRank int64
		err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(rank),0) FROM space_tasks WHERE space_id=$1 AND status=$2 AND id<>$3 AND archived_at IS NULL`, spaceID, status, taskID).Scan(&maxRank)
		return maxRank + 1024, err
	}
	var beforeRank int64
	if err := tx.QueryRowContext(ctx, `SELECT rank FROM space_tasks WHERE id=$1 AND space_id=$2 AND status=$3 AND id<>$4 AND archived_at IS NULL`, beforeTaskID, spaceID, status, taskID).Scan(&beforeRank); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrSpaceInvalid
		}
		return 0, err
	}
	var previousRank int64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(rank),0) FROM space_tasks WHERE space_id=$1 AND status=$2 AND id<>$3 AND rank<$4 AND archived_at IS NULL`, spaceID, status, taskID, beforeRank).Scan(&previousRank); err != nil {
		return 0, err
	}
	if beforeRank-previousRank <= 1 {
		return 0, nil
	}
	return previousRank + (beforeRank-previousRank)/2, nil
}

func rebalanceTaskColumn(ctx context.Context, tx *sql.Tx, spaceID, status, movingTaskID string) error {
	_, err := tx.ExecContext(ctx, `WITH ranked AS (SELECT id,ROW_NUMBER() OVER (ORDER BY rank,id)*1024 AS next_rank FROM space_tasks WHERE space_id=$1 AND status=$2 AND id<>$3 AND archived_at IS NULL) UPDATE space_tasks task SET rank=ranked.next_rank FROM ranked WHERE task.id=ranked.id`, spaceID, status, movingTaskID)
	return err
}

// ArchiveSpaceTask writes a tombstone. version is accepted for wire
// compatibility with existing clients but is deliberately not part of the
// predicate: archiving is last-write-wins and idempotent.
func (db *Database) ArchiveSpaceTask(ctx context.Context, actorUserID, spaceID, taskID string, _ int64) (*SpaceTask, error) {
	out := &SpaceTask{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, actorUserID, spaceID, PermissionTasksManage); err != nil {
			return err
		}
		// Archiving is idempotent and does not depend on the client's version:
		// re-archiving an already-archived task returns the existing tombstone
		// rather than conflicting.
		err := scanSpaceTask(tx.QueryRowContext(ctx, `UPDATE space_tasks SET archived_at=NOW(),version=version+1,updated_at=NOW() WHERE id=$1 AND space_id=$2 AND archived_at IS NULL RETURNING `+spaceTaskColumns, taskID, spaceID), out)
		if errors.Is(err, sql.ErrNoRows) {
			existing := scanSpaceTask(tx.QueryRowContext(ctx, `SELECT `+spaceTaskColumns+` FROM space_tasks WHERE id=$1 AND space_id=$2`, taskID, spaceID), out)
			if errors.Is(existing, sql.ErrNoRows) {
				return ErrSpaceNotFound
			}
			return existing
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

func (db *Database) SpaceCalendarEvents(ctx context.Context, userID, spaceID string, from, to time.Time) ([]SpaceCalendarEvent, error) {
	out := []SpaceCalendarEvent{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionTasksView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT id,space_id,source_id,provider,external_event_id,fingerprint,title,description,location,meeting_url,organizer,starts_at,ends_at,all_day,timezone,status,provider_created_at,provider_updated_at,removed_at,created_at,updated_at
			FROM space_calendar_events WHERE space_id=$1 AND starts_at<$2 AND ends_at>$3 AND removed_at IS NULL ORDER BY starts_at,id`, spaceID, to, from)
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
