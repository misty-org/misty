package api

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	serveragent "github.com/kannachi323/misty/server/internal/agents"
	"github.com/kannachi323/misty/server/internal/agenttools"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

// Scheduled tasks run a prompt with an agent at a set time, like the
// Scheduled page. Deleting one asks first when the account asks first.
func (s *SpacesService) scheduleToolRegistrations() []agenttools.Registration {
	base := agenttools.Descriptor{Version: 1, OutputSchema: agentToolObjectOutputSchema(), Locality: agenttools.LocalityServer, AllowCustomAgent: true, Approval: agenttools.ApprovalNone}
	schedule := map[string]any{
		"cadence":    map[string]any{"type": "string", "enum": []string{"once", "daily", "weekdays", "weekly", "monthly"}},
		"local_time": map[string]any{"type": "string", "pattern": "^[0-2][0-9]:[0-5][0-9]$", "description": "24-hour time, such as 08:30."},
		"weekday":    map[string]any{"type": "integer", "minimum": 0, "maximum": 6, "description": "0 is Sunday. Used by weekly."},
		"month_day":  map[string]any{"type": "integer", "minimum": 1, "maximum": 31, "description": "Used by monthly."},
		"run_on":     map[string]any{"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", "description": "Date for once, as YYYY-MM-DD."},
		"timezone":   map[string]any{"type": "string", "minLength": 1, "maxLength": 64, "description": "IANA timezone, such as America/Los_Angeles."},
	}
	fields := func(extra map[string]any) map[string]any {
		out := map[string]any{
			"title":   map[string]any{"type": "string", "minLength": 1, "maxLength": 120},
			"prompt":  map[string]any{"type": "string", "minLength": 1, "maxLength": 8000, "description": "What the agent should do each time, written as a complete instruction."},
			"enabled": map[string]any{"type": "boolean"},
		}
		for key, value := range schedule {
			out[key] = value
		}
		for key, value := range extra {
			out[key] = value
		}
		return out
	}
	list, create, update, remove := base, base, base, base
	list.Name, list.Risk, list.Idempotent = "schedules.list", serveragent.RiskRead, true
	list.Description = "List this account's scheduled tasks with their schedule, next run and last result."
	list.InputSchema = agentToolSchema(map[string]any{}, nil)
	create.Name, create.Risk, create.AuditEvent = "schedules.create", serveragent.RiskWrite, "scheduled_task.created"
	create.Description = "Schedule an agent to run a prompt once or on a repeating schedule. The agent you are defaults to running it."
	create.InputSchema = agentToolSchema(fields(map[string]any{"agent_id": map[string]any{"type": "string", "maxLength": 200}}), []string{"title", "prompt", "cadence", "local_time", "timezone"})
	update.Name, update.Risk, update.AuditEvent, update.Idempotent = "schedules.update", serveragent.RiskWrite, "scheduled_task.updated", true
	update.Description = "Change a scheduled task's title, prompt or schedule, pause and resume it with enabled, or set run_now to start it within a minute. Pass only what changes."
	update.InputSchema = agentToolSchema(fields(map[string]any{"id": map[string]any{"type": "string", "minLength": 1, "maxLength": 200}, "run_now": map[string]any{"type": "boolean"}}), []string{"id"})
	remove.Name, remove.Risk, remove.AuditEvent = "schedules.delete", serveragent.RiskWrite, "scheduled_task.deleted"
	remove.Description = "Delete a scheduled task. Use only when the user asked to delete it; to stop it for now, set enabled to false instead."
	remove.InputSchema = agentToolSchema(map[string]any{"id": map[string]any{"type": "string", "minLength": 1, "maxLength": 200}}, []string{"id"})
	return []agenttools.Registration{
		{Descriptor: list, Handler: func(ctx context.Context, invocation agenttools.Invocation, _ serveragent.ToolRequest) (json.RawMessage, error) {
			items, err := s.database.ScheduledTasks(ctx, invocation.UserID)
			if err != nil {
				return nil, err
			}
			return json.Marshal(map[string]any{"tasks": items})
		}},
		{Descriptor: create, Handler: s.executeScheduleCreate},
		{Descriptor: update, Handler: s.executeScheduleUpdate},
		{Descriptor: remove, Handler: s.executeScheduleDelete},
	}
}

type scheduleToolInput struct {
	ID        string  `json:"id"`
	AgentID   string  `json:"agent_id"`
	Title     *string `json:"title"`
	Prompt    *string `json:"prompt"`
	Enabled   *bool   `json:"enabled"`
	Cadence   *string `json:"cadence"`
	LocalTime *string `json:"local_time"`
	Weekday   *int    `json:"weekday"`
	MonthDay  *int    `json:"month_day"`
	RunOn     *string `json:"run_on"`
	Timezone  *string `json:"timezone"`
	RunNow    bool    `json:"run_now"`
}

// apply overlays the fields the model passed onto a task.
func (input scheduleToolInput) apply(task *db.ScheduledTask) {
	set := func(target *string, value *string) {
		if value != nil {
			*target = strings.TrimSpace(*value)
		}
	}
	set(&task.Title, input.Title)
	set(&task.Prompt, input.Prompt)
	set(&task.Cadence, input.Cadence)
	set(&task.LocalTime, input.LocalTime)
	set(&task.RunOn, input.RunOn)
	set(&task.Timezone, input.Timezone)
	if input.Enabled != nil {
		task.Enabled = *input.Enabled
	}
	if input.Weekday != nil {
		task.Weekday = *input.Weekday
	}
	if input.MonthDay != nil {
		task.MonthDay = *input.MonthDay
	}
}

const invalidScheduleMessage = "give the task a title, a complete prompt and a valid schedule: cadence, local_time as HH:MM, an IANA timezone, weekday for weekly, month_day for monthly and run_on for once"

func (s *SpacesService) executeScheduleCreate(ctx context.Context, invocation agenttools.Invocation, request serveragent.ToolRequest) (json.RawMessage, error) {
	var input scheduleToolInput
	if json.Unmarshal(request.Arguments, &input) != nil {
		return nil, agenttools.ErrArgumentsInvalid
	}
	task := db.ScheduledTask{Enabled: true, ScheduledTaskSchedule: db.ScheduledTaskSchedule{MonthDay: 1}}
	input.apply(&task)
	if !db.ValidScheduledTask(task) {
		return nil, serveragent.ErrInvalidRequest(invalidScheduleMessage)
	}
	existing, err := s.database.ScheduledTasks(ctx, invocation.UserID)
	if err != nil {
		return nil, err
	}
	if len(existing) >= maxScheduledTasksPerUser {
		return nil, serveragent.ErrInvalidRequest("this account already has the limit of 50 scheduled tasks")
	}
	agentID := strings.TrimSpace(input.AgentID)
	if agentID == "" {
		agentID = invocation.AgentID
	}
	conversationID, err := createScheduledTaskConversation(ctx, s.database, invocation.UserID, task.Title, agentID)
	if err != nil {
		return nil, err
	}
	created, err := s.database.CreateScheduledTask(ctx, invocation.UserID, conversationID, task, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"task": created})
}

func (s *SpacesService) executeScheduleUpdate(ctx context.Context, invocation agenttools.Invocation, request serveragent.ToolRequest) (json.RawMessage, error) {
	var input scheduleToolInput
	if json.Unmarshal(request.Arguments, &input) != nil {
		return nil, agenttools.ErrArgumentsInvalid
	}
	prior, err := s.database.ScheduledTaskByID(ctx, invocation.UserID, strings.TrimSpace(input.ID))
	if err != nil {
		return nil, serveragent.ErrInvalidRequest("no scheduled task " + input.ID + "; call schedules_list for ids")
	}
	task := *prior
	input.apply(&task)
	if !db.ValidScheduledTask(task) {
		return nil, serveragent.ErrInvalidRequest(invalidScheduleMessage)
	}
	updated, err := s.database.UpdateScheduledTask(ctx, invocation.UserID, task, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	if input.RunNow {
		if err := s.database.RunScheduledTaskNow(ctx, invocation.UserID, updated.ID, time.Now().UTC()); err != nil {
			return nil, err
		}
		return json.Marshal(map[string]any{"task": updated, "running": "starts within a minute"})
	}
	return json.Marshal(map[string]any{"task": updated})
}

func (s *SpacesService) executeScheduleDelete(ctx context.Context, invocation agenttools.Invocation, request serveragent.ToolRequest) (json.RawMessage, error) {
	var input struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(request.Arguments, &input) != nil {
		return nil, agenttools.ErrArgumentsInvalid
	}
	task, err := s.database.ScheduledTaskByID(ctx, invocation.UserID, strings.TrimSpace(input.ID))
	if err != nil {
		return nil, serveragent.ErrInvalidRequest("no scheduled task " + input.ID + "; call schedules_list for ids")
	}
	approval, waiting, err := s.confirmAgentAction(ctx, invocation, "misty.schedules.delete", task.ID, "Delete scheduled task “"+task.Title+"”", "Runs: "+task.Cadence+" at "+task.LocalTime+" "+task.Timezone)
	if err != nil || waiting != nil {
		return waiting, err
	}
	if err := s.useAgentActionApproval(ctx, invocation.UserID, approval); err != nil {
		return nil, err
	}
	if err := s.database.DeleteScheduledTask(ctx, invocation.UserID, task.ID); err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"deleted": task.ID, "title": task.Title})
}
