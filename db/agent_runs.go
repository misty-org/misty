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

var ErrWorkflowIntegrationRequired = errors.New("workflow integration required")

type AgentRunRequest struct {
	RequestingMemberID   string          `json:"requesting_member_id"`
	SpaceID              string          `json:"space_id"`
	AgentID              string          `json:"agent_id"`
	SourceConversationID string          `json:"source_conversation_id,omitempty"`
	SourceType           string          `json:"source_type"`
	CapabilityID         string          `json:"capability_id,omitempty"`
	Input                json.RawMessage `json:"input"`
	TriggerKind          string          `json:"trigger_kind"`
}

type RunAction struct {
	ID          string          `json:"id"`
	RunID       string          `json:"run_id"`
	ActionKind  string          `json:"action_kind"`
	Summary     string          `json:"summary"`
	Details     json.RawMessage `json:"details"`
	Destructive bool            `json:"destructive"`
	State       string          `json:"state"`
	PerformedAt *time.Time      `json:"performed_at,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
}

type RunApproval struct {
	ID                  string          `json:"id"`
	RunID               string          `json:"run_id"`
	RequestedFromUserID string          `json:"requested_from_user_id"`
	DecidedByUserID     string          `json:"decided_by_user_id,omitempty"`
	ActionSummary       string          `json:"action_summary"`
	ProposedActions     json.RawMessage `json:"proposed_actions"`
	State               string          `json:"state"`
	CreatedAt           time.Time       `json:"created_at"`
	DecidedAt           *time.Time      `json:"decided_at,omitempty"`
	ExpiresAt           time.Time       `json:"expires_at"`
}

type PrivateAgentConversation struct {
	ID          string    `json:"id"`
	SpaceID     string    `json:"space_id"`
	OwnerUserID string    `json:"owner_user_id"`
	AgentID     string    `json:"agent_id"`
	AgentName   string    `json:"agent_name"`
	Title       string    `json:"title"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type PrivateConversationEvent struct {
	ID             int64           `json:"id"`
	ConversationID string          `json:"conversation_id"`
	UserID         string          `json:"user_id"`
	EventType      string          `json:"event_type"`
	Data           json.RawMessage `json:"data"`
	CreatedAt      time.Time       `json:"created_at"`
}

const spaceRunColumns = `id,space_id,resource_kind,resource_id,initiated_by_user_id,billing_user_id,trigger_kind,state,input,result,COALESCE(error_code,''),created_at,completed_at,requesting_member_id,COALESCE(source_conversation_id,''),source_type,COALESCE(agent_id,''),COALESCE(workflow_identifier,''),COALESCE(workflow_version_id,''),COALESCE(workflow_version,''),COALESCE(capability_id,''),progress,outputs,artifacts,COALESCE(error_message,''),COALESCE(retry_of_run_id,''),canceled_at,updated_at`

func (db *Database) CreateAgentRun(ctx context.Context, request AgentRunRequest) (*SpaceRun, error) {
	if !validRunSource(request.SourceType) || strings.TrimSpace(request.RequestingMemberID) == "" || strings.TrimSpace(request.AgentID) == "" {
		return nil, ErrSpaceInvalid
	}
	if len(request.Input) == 0 {
		request.Input = json.RawMessage(`{}`)
	}
	if !validJSONObject(request.Input) {
		return nil, ErrSpaceInvalid
	}
	out := &SpaceRun{
		ID: "run_" + uuid.NewString(), SpaceID: request.SpaceID, ResourceKind: "agent", ResourceID: request.AgentID,
		InitiatedByUserID: request.RequestingMemberID, BillingUserID: request.RequestingMemberID, TriggerKind: request.TriggerKind,
		RequestingMemberID: request.RequestingMemberID, SourceConversationID: request.SourceConversationID, SourceType: request.SourceType,
		AgentID: request.AgentID, Input: request.Input, Result: json.RawMessage(`{}`), Outputs: json.RawMessage(`{}`), Artifacts: json.RawMessage(`[]`),
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, request.RequestingMemberID, request.SpaceID, PermissionAgentsRun); err != nil {
			return err
		}
		var enabled bool
		var versionID string
		if err := tx.QueryRowContext(ctx, `SELECT enabled,active_workflow_version_id FROM space_agents WHERE id=$1 AND space_id=$2 AND status='available'`, request.AgentID, request.SpaceID).Scan(&enabled, &versionID); err != nil {
			return err
		}
		if !enabled {
			return ErrSpaceInvalid
		}
		workflow, err := loadWorkflowVersionTx(ctx, tx, versionID)
		if err != nil {
			return err
		}
		capability, err := selectWorkflowCapability(workflow.Metadata, request.CapabilityID)
		if err != nil {
			return err
		}
		if err := authorizeWorkflowRequirementsTx(ctx, tx, request.RequestingMemberID, request.SpaceID, workflow.Metadata); err != nil {
			return err
		}
		out.WorkflowIdentifier, out.WorkflowVersionID, out.WorkflowVersion = workflow.StableIdentifier, workflow.ID, workflow.Version
		out.CapabilityID = capability.ID
		out.State = "running"
		if capability.Destructive || capability.ConfirmationRequired {
			out.State = "awaiting_approval"
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_runs(id,space_id,resource_kind,resource_id,initiated_by_user_id,billing_user_id,trigger_kind,state,input,requesting_member_id,source_conversation_id,source_type,agent_id,workflow_identifier,workflow_version_id,workflow_version,capability_id,outputs,artifacts)
			VALUES($1,$2,'agent',$3,$4,$4,$5,$6,$7,$4,NULLIF($8,''),$9,$3,$10,$11,$12,$13,'{}'::jsonb,'[]'::jsonb) RETURNING created_at,updated_at`,
			out.ID, request.SpaceID, request.AgentID, request.RequestingMemberID, request.TriggerKind, out.State, request.Input, request.SourceConversationID, request.SourceType, out.WorkflowIdentifier, out.WorkflowVersionID, out.WorkflowVersion, out.CapabilityID).Scan(&out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		if out.State == "awaiting_approval" {
			proposed := mustJSON([]map[string]any{{"capability_id": capability.ID, "description": capability.Description, "destructive": capability.Destructive}})
			if _, err := tx.ExecContext(ctx, `INSERT INTO space_run_approvals(id,run_id,requested_from_user_id,action_summary,proposed_actions) VALUES($1,$2,$3,$4,$5)`, "runapproval_"+uuid.NewString(), out.ID, request.RequestingMemberID, "Approve "+capability.Name, proposed); err != nil {
				return err
			}
		}
		_, err = recordSpaceEventTx(ctx, tx, request.SpaceID, request.RequestingMemberID, "agent.run.started", out.ID, map[string]any{"agent_id": request.AgentID, "workflow_version": out.WorkflowVersion, "capability_id": out.CapabilityID, "source_type": out.SourceType})
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func authorizeWorkflowRequirementsTx(ctx context.Context, tx *sql.Tx, userID, spaceID string, metadata WorkflowMetadata) error {
	configurable := map[string]bool{}
	for _, permission := range configurableSpacePermissions {
		configurable[permission] = true
	}
	for _, permission := range metadata.RequiredPermissions {
		if configurable[permission] {
			if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, permission); err != nil {
				return err
			}
		}
	}
	for _, provider := range metadata.RequiredIntegrations {
		var available bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_integrations WHERE space_id=$1 AND provider=$2 AND status='active')`, spaceID, provider).Scan(&available); err != nil {
			return err
		}
		if !available {
			return ErrWorkflowIntegrationRequired
		}
	}
	return nil
}

func selectWorkflowCapability(metadata WorkflowMetadata, requested string) (*WorkflowCapability, error) {
	if requested == "" && len(metadata.Capabilities) == 1 {
		return &metadata.Capabilities[0], nil
	}
	for index := range metadata.Capabilities {
		if metadata.Capabilities[index].ID == requested {
			return &metadata.Capabilities[index], nil
		}
	}
	return nil, ErrSpaceInvalid
}

func validRunSource(value string) bool {
	switch value {
	case "direct", "group_mention", "mika", "studio_test", "schedule":
		return true
	default:
		return false
	}
}

func (db *Database) SpaceRuns(ctx context.Context, userID, spaceID, agentID string, limit int) ([]SpaceRun, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	items := []SpaceRun{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStudioView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT `+spaceRunColumns+` FROM space_runs WHERE space_id=$1 AND ($2='' OR agent_id=$2) AND (source_type='group_mention' OR requesting_member_id=$3) ORDER BY created_at DESC LIMIT $4`, spaceID, agentID, userID, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceRun
			if err := scanSpaceRun(rows, &item); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) SpaceRun(ctx context.Context, userID, runID string) (*SpaceRun, error) {
	out := &SpaceRun{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := scanSpaceRun(tx.QueryRowContext(ctx, `SELECT `+spaceRunColumns+` FROM space_runs WHERE id=$1`, runID), out); err != nil {
			return err
		}
		if out.SourceType != "group_mention" && out.RequestingMemberID != userID {
			return ErrSpaceForbidden
		}
		return requireSpacePermissionTx(ctx, tx, userID, out.SpaceID, PermissionStudioView)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) DecideRunApproval(ctx context.Context, userID, runID string, approved bool) (*SpaceRun, error) {
	out := &SpaceRun{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := scanSpaceRun(tx.QueryRowContext(ctx, `SELECT `+spaceRunColumns+` FROM space_runs WHERE id=$1 FOR UPDATE`, runID), out); err != nil {
			return err
		}
		if out.RequestingMemberID != userID || out.State != "awaiting_approval" {
			return ErrSpaceForbidden
		}
		if err := requireSpacePermissionTx(ctx, tx, userID, out.SpaceID, PermissionAgentsRun); err != nil {
			return err
		}
		workflow, err := loadWorkflowVersionTx(ctx, tx, out.WorkflowVersionID)
		if err != nil {
			return err
		}
		if err := authorizeWorkflowRequirementsTx(ctx, tx, userID, out.SpaceID, workflow.Metadata); err != nil {
			return err
		}
		decision, state := "rejected", "canceled"
		if approved {
			decision, state = "approved", "running"
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_run_approvals SET state=$1,decided_by_user_id=$2,decided_at=NOW() WHERE run_id=$3 AND state='pending'`, decision, userID, runID); err != nil {
			return err
		}
		if err := scanSpaceRun(tx.QueryRowContext(ctx, `UPDATE space_runs SET state=$1,canceled_at=CASE WHEN $1='canceled' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$2 RETURNING `+spaceRunColumns, state, runID), out); err != nil {
			return err
		}
		_, err = recordSpaceEventTx(ctx, tx, out.SpaceID, userID, "agent.run.approval."+decision, runID, map[string]bool{"approved": approved})
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) CreatePrivateAgentConversation(ctx context.Context, userID, spaceID, agentID, title string) (*PrivateAgentConversation, error) {
	out := &PrivateAgentConversation{ID: "spaceconversation_" + uuid.NewString(), SpaceID: spaceID, OwnerUserID: userID, AgentID: agentID, Title: strings.TrimSpace(title)}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionAgentsRun); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `INSERT INTO space_agent_conversations(id,space_id,owner_user_id,agent_id,title) SELECT $1,$2,$3,a.id,$4 FROM space_agents a WHERE a.id=$5 AND a.space_id=$2 AND a.enabled RETURNING created_at,updated_at`, out.ID, spaceID, userID, out.Title, agentID).Scan(&out.CreatedAt, &out.UpdatedAt)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) AppendPrivateConversationEvent(ctx context.Context, userID, conversationID, eventType string, data json.RawMessage) (*PrivateConversationEvent, error) {
	if eventType != "user_message" && eventType != "agent_message" && eventType != "run" && eventType != "error" || !validJSONObject(data) {
		return nil, ErrSpaceInvalid
	}
	out := &PrivateConversationEvent{ConversationID: conversationID, UserID: userID, EventType: eventType, Data: data}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var spaceID string
		if err := tx.QueryRowContext(ctx, `SELECT space_id FROM space_agent_conversations WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, conversationID, userID).Scan(&spaceID); err != nil {
			return err
		}
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionAgentsRun); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_agent_conversation_events(conversation_id,user_id,event_type,data) VALUES($1,$2,$3,$4) RETURNING id,created_at`, conversationID, userID, eventType, data).Scan(&out.ID, &out.CreatedAt); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE space_agent_conversations SET updated_at=NOW() WHERE id=$1`, conversationID)
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) PrivateConversationEvents(ctx context.Context, userID, conversationID string) ([]PrivateConversationEvent, error) {
	items := []PrivateConversationEvent{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var spaceID string
		if err := tx.QueryRowContext(ctx, `SELECT space_id FROM space_agent_conversations WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, conversationID, userID).Scan(&spaceID); err != nil {
			return err
		}
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionAgentsRun); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT id,conversation_id,user_id,event_type,data,created_at FROM space_agent_conversation_events WHERE conversation_id=$1 AND user_id=$2 ORDER BY id`, conversationID, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item PrivateConversationEvent
			if err := rows.Scan(&item.ID, &item.ConversationID, &item.UserID, &item.EventType, &item.Data, &item.CreatedAt); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return items, err
}

func scanSpaceRun(scanner interface{ Scan(...any) error }, out *SpaceRun) error {
	return scanner.Scan(&out.ID, &out.SpaceID, &out.ResourceKind, &out.ResourceID, &out.InitiatedByUserID, &out.BillingUserID, &out.TriggerKind, &out.State, &out.Input, &out.Result, &out.ErrorCode, &out.CreatedAt, &out.CompletedAt, &out.RequestingMemberID, &out.SourceConversationID, &out.SourceType, &out.AgentID, &out.WorkflowIdentifier, &out.WorkflowVersionID, &out.WorkflowVersion, &out.CapabilityID, &out.Progress, &out.Outputs, &out.Artifacts, &out.ErrorMessage, &out.RetryOfRunID, &out.CanceledAt, &out.UpdatedAt)
}
