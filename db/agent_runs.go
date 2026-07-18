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

type AgentConversation struct {
	ID          string    `json:"id"`
	SpaceID     string    `json:"space_id"`
	OwnerUserID string    `json:"owner_user_id"`
	AgentID     string    `json:"agent_id"`
	AgentName   string    `json:"agent_name"`
	Title       string    `json:"title"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type AgentConversationEvent struct {
	ID             int64           `json:"id"`
	ConversationID string          `json:"conversation_id"`
	UserID         string          `json:"user_id"`
	EventType      string          `json:"event_type"`
	Data           json.RawMessage `json:"data"`
	CreatedAt      time.Time       `json:"created_at"`
}

const spaceRunColumns = `id,space_id,resource_kind,resource_id,initiated_by_user_id,billing_user_id,trigger_kind,state,input,result,COALESCE(error_code,''),created_at,completed_at,requesting_member_id,COALESCE(source_conversation_id,''),source_type,COALESCE(agent_id,''),COALESCE(workflow_identifier,''),COALESCE(workflow_version_id,''),COALESCE(workflow_version,''),COALESCE(capability_id,''),progress,outputs,artifacts,COALESCE(error_message,''),COALESCE(retry_of_run_id,''),canceled_at,updated_at,COALESCE(agent_instance_id,''),COALESCE(agent_version_id,''),attempt,next_retry_at`

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
	instance, err := db.EnsureAgentInstance(ctx, request.RequestingMemberID, request.SpaceID, request.AgentID)
	if err != nil {
		return nil, err
	}
	out := &SpaceRun{
		ID: "run_" + uuid.NewString(), SpaceID: request.SpaceID, ResourceKind: "agent", ResourceID: request.AgentID,
		InitiatedByUserID: request.RequestingMemberID, BillingUserID: request.RequestingMemberID, TriggerKind: request.TriggerKind,
		RequestingMemberID: request.RequestingMemberID, SourceConversationID: request.SourceConversationID, SourceType: request.SourceType,
		AgentID: request.AgentID, AgentInstanceID: instance.ID, AgentVersionID: instance.AgentVersionID, Attempt: 1,
		Input: request.Input, Result: json.RawMessage(`{}`), Outputs: json.RawMessage(`{}`), Artifacts: json.RawMessage(`[]`),
	}
	err = db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, request.RequestingMemberID, request.SpaceID, PermissionAgentsRun); err != nil {
			return err
		}
		var enabled bool
		if err := tx.QueryRowContext(ctx, `SELECT enabled FROM space_agents WHERE id=$1 AND space_id=$2 AND status='available'`, request.AgentID, request.SpaceID).Scan(&enabled); err != nil {
			return err
		}
		if !enabled {
			return ErrSpaceInvalid
		}
		out.State = "running"
		out.CapabilityID = strings.TrimSpace(request.CapabilityID)
		var workflow *WorkflowVersion
		var capability *WorkflowCapability
		if out.CapabilityID == "" || out.CapabilityID == "chat" {
			out.CapabilityID = "chat"
		} else {
			var err error
			workflow, capability, err = resolveAgentWorkflowCapabilityTx(ctx, tx, instance.AgentVersionID, out.CapabilityID)
			if err != nil {
				return err
			}
			if err := validateCapabilityInput(*capability, request.Input); err != nil {
				return err
			}
			if err := authorizeAgentWorkflowRequirementsTx(ctx, tx, request.RequestingMemberID, request.SpaceID, instance.ID, workflow.Metadata); err != nil {
				return err
			}
			if request.SourceType == "schedule" {
				var automationEnabled bool
				if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_agent_instance_workflows WHERE instance_id=$1 AND workflow_version_id=$2 AND enabled AND consent->>'granted'='true')`, instance.ID, workflow.ID).Scan(&automationEnabled); err != nil || !automationEnabled {
					return ErrSpaceForbidden
				}
			}
			out.WorkflowIdentifier, out.WorkflowVersionID, out.WorkflowVersion = workflow.StableIdentifier, workflow.ID, workflow.Version
			// Destructive graph nodes request approval only after their exact,
			// fingerprinted action input is known. Non-destructive capabilities
			// may still require an up-front workflow confirmation.
			if capability.ConfirmationRequired && !capability.Destructive {
				out.State = "awaiting_approval"
			}
		}
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_runs(id,space_id,resource_kind,resource_id,initiated_by_user_id,billing_user_id,trigger_kind,state,input,requesting_member_id,source_conversation_id,source_type,agent_id,workflow_identifier,workflow_version_id,workflow_version,capability_id,outputs,artifacts,agent_instance_id,agent_version_id,attempt)
			VALUES($1,$2,'agent',$3,$4,$4,$5,$6,$7,$4,NULLIF($8,''),$9,$3,NULLIF($10,''),NULLIF($11,''),NULLIF($12,''),$13,'{}'::jsonb,'[]'::jsonb,$14,$15,1) RETURNING created_at,updated_at`,
			out.ID, request.SpaceID, request.AgentID, request.RequestingMemberID, request.TriggerKind, out.State, request.Input, request.SourceConversationID, request.SourceType, out.WorkflowIdentifier, out.WorkflowVersionID, out.WorkflowVersion, out.CapabilityID, instance.ID, instance.AgentVersionID).Scan(&out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		if out.State == "awaiting_approval" {
			if err := insertRunApprovalTx(ctx, tx, out.ID, request.RequestingMemberID, capability, workflow.ID); err != nil {
				return err
			}
		}
		_, err = recordSpaceEventTx(ctx, tx, request.SpaceID, request.RequestingMemberID, "agent.run.started", out.ID, map[string]any{"agent_id": request.AgentID, "workflow_version": out.WorkflowVersion, "capability_id": out.CapabilityID, "source_type": out.SourceType})
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	if err != nil {
		return nil, err
	}
	return out, nil
}

func authorizeAgentWorkflowRequirementsTx(ctx context.Context, tx *sql.Tx, userID, spaceID, instanceID string, metadata WorkflowMetadata) error {
	for _, permission := range metadata.RequiredPermissions {
		spacePermission, ok := workflowPermissionSpacePermission(permission)
		if ok {
			if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, spacePermission); err != nil {
				return err
			}
		}
	}
	for _, provider := range metadata.RequiredIntegrations {
		var available bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_agent_instances i JOIN space_integrations c ON c.id=i.connection_bindings->>$3 WHERE i.id=$1 AND i.user_id=$2 AND c.connected_by_user_id=$2 AND c.status='active')`, instanceID, userID, provider).Scan(&available); err != nil {
			return err
		}
		if !available {
			return ErrWorkflowIntegrationRequired
		}
	}
	return nil
}

func resolveAgentWorkflowCapabilityTx(ctx context.Context, tx *sql.Tx, agentVersionID, capabilityID string) (*WorkflowVersion, *WorkflowCapability, error) {
	rows, err := tx.QueryContext(ctx, `SELECT workflow_version_id FROM space_agent_version_workflows WHERE agent_version_id=$1 AND enabled ORDER BY position,alias`, agentVersionID)
	if err != nil {
		return nil, nil, err
	}
	versionIDs := []string{}
	for rows.Next() {
		var versionID string
		if err := rows.Scan(&versionID); err != nil {
			rows.Close()
			return nil, nil, err
		}
		versionIDs = append(versionIDs, versionID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, nil, err
	}
	for _, versionID := range versionIDs {
		workflow, err := loadWorkflowVersionTx(ctx, tx, versionID)
		if err != nil {
			return nil, nil, err
		}
		for index := range workflow.Metadata.Capabilities {
			if workflow.Metadata.Capabilities[index].ID == capabilityID {
				return workflow, &workflow.Metadata.Capabilities[index], nil
			}
		}
	}
	return nil, nil, ErrSpaceInvalid
}

func insertRunApprovalTx(ctx context.Context, tx *sql.Tx, runID, userID string, capability *WorkflowCapability, workflowVersionID string) error {
	proposed := mustJSON([]map[string]any{{"capability_id": capability.ID, "description": capability.Description, "destructive": capability.Destructive}})
	if _, err := tx.ExecContext(ctx, `INSERT INTO space_run_approvals(id,run_id,requested_from_user_id,action_summary,proposed_actions) VALUES($1,$2,$3,$4,$5)`, "runapproval_"+uuid.NewString(), runID, userID, "Approve "+capability.Name, proposed); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO space_run_actions(id,run_id,action_kind,summary,details,destructive,state) VALUES($1,$2,$3,$4,$5,$6,'proposed')`, "runaction_"+uuid.NewString(), runID, capability.ID, capability.Description, mustJSON(map[string]any{"capability_id": capability.ID, "workflow_version_id": workflowVersionID}), capability.Destructive)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO space_inbox_items(user_id,space_id,kind,payload) SELECT $1,space_id,'approval',$2 FROM space_runs WHERE id=$3`, userID, mustJSON(map[string]any{"run_id": runID, "capability_id": capability.ID, "workflow_version_id": workflowVersionID}), runID)
	return err
}

func (db *Database) AgentExecutionContext(ctx context.Context, userID, spaceID, agentID string, versionIDs ...string) (*SpaceStudioResource, *WorkflowVersion, error) {
	resource := &SpaceStudioResource{Kind: "agent"}
	var workflow *WorkflowVersion
	agentVersionID, workflowVersionID := "", ""
	if len(versionIDs) == 1 {
		workflowVersionID = versionIDs[0]
	} else if len(versionIDs) == 2 {
		agentVersionID, workflowVersionID = versionIDs[0], versionIDs[1]
	} else {
		return nil, nil, ErrSpaceInvalid
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionAgentsRun); err != nil {
			return err
		}
		if agentVersionID == "" {
			if err := tx.QueryRowContext(ctx, `SELECT COALESCE(published_agent_version_id,'') FROM space_agents WHERE id=$1 AND space_id=$2`, agentID, spaceID).Scan(&agentVersionID); err != nil {
				return err
			}
		}
		if err := tx.QueryRowContext(ctx, `SELECT a.id,a.space_id,a.creator_user_id,v.name,v.description,v.icon,v.instructions,a.enabled,a.status,a.runtime_kind,a.version,a.schedules_enabled,COALESCE(a.active_workflow_version_id,''),a.created_at,a.updated_at FROM space_agents a JOIN space_agent_versions v ON v.id=$3 AND v.agent_id=a.id WHERE a.id=$1 AND a.space_id=$2 AND a.enabled AND a.status='available'`, agentID, spaceID, agentVersionID).Scan(&resource.ID, &resource.SpaceID, &resource.CreatorUserID, &resource.Name, &resource.Description, &resource.Icon, &resource.Instructions, &resource.Enabled, &resource.Status, &resource.RuntimeKind, &resource.Version, &resource.SchedulesEnabled, &resource.ActiveWorkflowVersionID, &resource.CreatedAt, &resource.UpdatedAt); err != nil {
			return err
		}
		if workflowVersionID != "" {
			var err error
			workflow, err = loadWorkflowVersionTx(ctx, tx, workflowVersionID)
			if err != nil {
				return err
			}
			var attached bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_agent_version_workflows WHERE agent_version_id=$1 AND workflow_version_id=$2 AND enabled)`, agentVersionID, workflowVersionID).Scan(&attached); err != nil || !attached || workflow.SpaceID != spaceID {
				return ErrSpaceForbidden
			}
		}
		return nil
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrSpaceNotFound
	}
	return resource, workflow, err
}

func authorizeWorkflowRequirementsTx(ctx context.Context, tx *sql.Tx, userID, spaceID string, metadata WorkflowMetadata) error {
	for _, permission := range metadata.RequiredPermissions {
		spacePermission, ok := workflowPermissionSpacePermission(permission)
		if ok {
			if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, spacePermission); err != nil {
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

func workflowPermissionSpacePermission(permission string) (string, bool) {
	switch permission {
	case "files.read":
		return PermissionLibraryView, true
	case "files.write":
		return PermissionLibraryEdit, true
	}
	for _, candidate := range configurableSpacePermissions {
		if permission == candidate {
			return candidate, true
		}
	}
	return "", false
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
	case "direct", "group_mention", "mika", "studio_test", "schedule", "connector", "task":
		return true
	default:
		return false
	}
}

func sharedSpaceRunVisibleToUserTx(ctx context.Context, tx *sql.Tx, run *SpaceRun, userID string) (bool, error) {
	if run.RequestingMemberID == userID {
		return true, nil
	}
	switch run.SourceType {
	case "schedule":
		return true, nil
	case "group_mention":
		var conversationExists, member bool
		if err := tx.QueryRowContext(ctx, `SELECT
			EXISTS(SELECT 1 FROM space_conversations c WHERE c.id=$1 AND c.space_id=$2),
			EXISTS(SELECT 1 FROM space_conversation_members cm JOIN space_conversations c ON c.id=cm.conversation_id WHERE cm.conversation_id=$1 AND cm.user_id=$3 AND c.space_id=$2)`, run.SourceConversationID, run.SpaceID, userID).Scan(&conversationExists, &member); err != nil {
			return false, err
		}
		if conversationExists {
			return member, nil
		}
		return true, nil // Everyone chat stores its source message ID here.
	default:
		return false, nil
	}
}

const sharedSpaceRunListVisibility = `(requesting_member_id=$3 OR source_type='schedule' OR (source_type='group_mention' AND (
	NOT EXISTS(SELECT 1 FROM space_conversations c WHERE c.id=space_runs.source_conversation_id AND c.space_id=space_runs.space_id)
	OR EXISTS(SELECT 1 FROM space_conversation_members cm JOIN space_conversations c ON c.id=cm.conversation_id WHERE cm.conversation_id=space_runs.source_conversation_id AND cm.user_id=$3 AND c.space_id=space_runs.space_id)
)))`

func (db *Database) SpaceRuns(ctx context.Context, userID, spaceID, agentID string, limit int) ([]SpaceRun, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	items := []SpaceRun{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStudioView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT `+spaceRunColumns+` FROM space_runs WHERE space_id=$1 AND ($2='' OR agent_id=$2) AND `+sharedSpaceRunListVisibility+` ORDER BY created_at DESC LIMIT $4`, spaceID, agentID, userID, limit)
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

func (db *Database) SpaceWorkflowRuns(ctx context.Context, userID, spaceID, workflowID string, limit int) ([]SpaceRun, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	items := []SpaceRun{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStudioView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT `+spaceRunColumns+` FROM space_runs WHERE space_id=$1 AND resource_kind='workflow' AND resource_id=$2 AND `+sharedSpaceRunListVisibility+` ORDER BY created_at DESC LIMIT $4`, spaceID, workflowID, userID, limit)
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
		visible, err := sharedSpaceRunVisibleToUserTx(ctx, tx, out, userID)
		if err != nil {
			return err
		}
		if !visible {
			return ErrSpaceForbidden
		}
		if out.RequestingMemberID == userID {
			return requireSpacePermissionTx(ctx, tx, userID, out.SpaceID, PermissionAgentsRun)
		}
		return requireSpacePermissionTx(ctx, tx, userID, out.SpaceID, PermissionStudioView)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	if err != nil {
		return nil, err
	}
	return out, nil
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
		if err := authorizeAgentWorkflowRequirementsTx(ctx, tx, userID, out.SpaceID, out.AgentInstanceID, workflow.Metadata); err != nil {
			return err
		}
		if err := requireRunResourceEnabledTx(ctx, tx, out); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_run_approvals SET state='expired' WHERE run_id=$1 AND state='pending' AND expires_at<=NOW()`, runID); err != nil {
			return err
		}
		var pending int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM space_run_approvals WHERE run_id=$1 AND state='pending' AND expires_at>NOW()`, runID).Scan(&pending); err != nil {
			return err
		}
		if pending == 0 {
			return ErrSpaceConflict
		}
		decision, state := "rejected", "rejected"
		if approved {
			decision, state = "approved", "running"
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_run_approvals SET state=$1,decided_by_user_id=$2,decided_at=NOW() WHERE run_id=$3 AND state='pending' AND expires_at>NOW()`, decision, userID, runID); err != nil {
			return err
		}
		actionState := "canceled"
		if approved {
			actionState = "approved"
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_run_actions SET state=$1 WHERE run_id=$2 AND state='proposed'`, actionState, runID); err != nil {
			return err
		}
		if err := scanSpaceRun(tx.QueryRowContext(ctx, `UPDATE space_runs SET state=$1,completed_at=CASE WHEN $1='rejected' THEN NOW() ELSE completed_at END,updated_at=NOW() WHERE id=$2 RETURNING `+spaceRunColumns, state, runID), out); err != nil {
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

func (db *Database) CreateAgentConversation(ctx context.Context, userID, spaceID, agentID, title string) (*AgentConversation, error) {
	if _, err := db.EnsureAgentInstance(ctx, userID, spaceID, agentID); err != nil {
		return nil, err
	}
	out := &AgentConversation{ID: "spaceconversation_" + uuid.NewString(), SpaceID: spaceID, OwnerUserID: userID, AgentID: agentID, Title: strings.TrimSpace(title)}
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

func (db *Database) AppendAgentConversationEvent(ctx context.Context, userID, conversationID, eventType string, data json.RawMessage) (*AgentConversationEvent, error) {
	if eventType != "user_message" && eventType != "agent_message" && eventType != "run" && eventType != "error" || !validJSONObject(data) {
		return nil, ErrSpaceInvalid
	}
	out := &AgentConversationEvent{ConversationID: conversationID, UserID: userID, EventType: eventType, Data: data}
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

func (db *Database) AgentConversationEvents(ctx context.Context, userID, conversationID string) ([]AgentConversationEvent, error) {
	items := []AgentConversationEvent{}
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
			var item AgentConversationEvent
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
	return scanner.Scan(&out.ID, &out.SpaceID, &out.ResourceKind, &out.ResourceID, &out.InitiatedByUserID, &out.BillingUserID, &out.TriggerKind, &out.State, &out.Input, &out.Result, &out.ErrorCode, &out.CreatedAt, &out.CompletedAt, &out.RequestingMemberID, &out.SourceConversationID, &out.SourceType, &out.AgentID, &out.WorkflowIdentifier, &out.WorkflowVersionID, &out.WorkflowVersion, &out.CapabilityID, &out.Progress, &out.Outputs, &out.Artifacts, &out.ErrorMessage, &out.RetryOfRunID, &out.CanceledAt, &out.UpdatedAt, &out.AgentInstanceID, &out.AgentVersionID, &out.Attempt, &out.NextRetryAt)
}
