package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/robfig/cron/v3"
)

var standardAgentCronParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)

// EnqueueDueAgentSchedules coalesces every missed interval into at most one
// current queued run. An already-active scheduled run suppresses another.
func (db *Database) EnqueueDueAgentSchedules(ctx context.Context, now time.Time) (int, error) {
	type schedule struct {
		triggerID, agentID, ownerID, deviceID, expression string
		baseline                                          time.Time
	}
	queued := 0
	err := db.withRLSContext(ctx, serviceRLSSettings(), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `
			SELECT t.id,t.agent_id,a.owner_user_id,a.device_id,t.config,
				COALESCE((SELECT MAX(j.created_at) FROM agent_jobs j WHERE j.agent_id=a.id AND j.trigger_kind='schedule'),t.updated_at)
			FROM agent_triggers t JOIN agent_definitions a ON a.id=t.agent_id
			WHERE t.kind='schedule' AND t.enabled AND a.enabled AND a.deleted_at IS NULL`)
		if err != nil {
			return err
		}
		var schedules []schedule
		for rows.Next() {
			var item schedule
			var config json.RawMessage
			if err := rows.Scan(&item.triggerID, &item.agentID, &item.ownerID, &item.deviceID, &config, &item.baseline); err != nil {
				rows.Close()
				return err
			}
			var values struct {
				Schedule string `json:"schedule"`
			}
			if json.Unmarshal(config, &values) == nil {
				item.expression = values.Schedule
			}
			schedules = append(schedules, item)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, item := range schedules {
			spec, err := standardAgentCronParser.Parse(item.expression)
			if err != nil || spec.Next(item.baseline).After(now) {
				continue
			}
			var active bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM agent_jobs WHERE agent_id=$1 AND trigger_kind='schedule' AND state IN ('queued','leased','running','awaiting_approval'))`, item.agentID).Scan(&active); err != nil {
				return err
			}
			if active {
				continue
			}
			payload, _ := json.Marshal(map[string]any{"scheduleTriggerId": item.triggerID, "scheduledFor": now.UTC().Format(time.RFC3339)})
			idempotencyKey := fmt.Sprintf("schedule:%s:%s", item.triggerID, now.UTC().Format("200601021504"))
			result, err := tx.ExecContext(ctx, `INSERT INTO agent_jobs(id,agent_id,owner_user_id,requester_user_id,device_id,trigger_kind,idempotency_key,payload)
				VALUES($1,$2,$3,$3,$4,'schedule',$5,$6) ON CONFLICT(requester_user_id,idempotency_key) DO NOTHING`,
				"job_"+uuid.NewString(), item.agentID, item.ownerID, item.deviceID, idempotencyKey, payload)
			if err != nil {
				return err
			}
			inserted, _ := result.RowsAffected()
			queued += int(inserted)
		}
		return nil
	})
	return queued, err
}

func agentScheduleDue(expression string, baseline, now time.Time) bool {
	spec, err := standardAgentCronParser.Parse(expression)
	return err == nil && !spec.Next(baseline).After(now)
}

func ValidAgentSchedule(expression string) bool {
	_, err := standardAgentCronParser.Parse(expression)
	return err == nil
}
