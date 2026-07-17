package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

func (db *Database) syncSpaceRunFromAgentJob(ctx context.Context, job *AgentJob) error {
	if job == nil {
		return nil
	}
	var payload struct {
		SpaceRunID string `json:"space_run_id"`
	}
	if json.Unmarshal(job.Payload, &payload) != nil || payload.SpaceRunID == "" {
		return nil
	}
	switch job.State {
	case AgentJobCompleted:
		result := job.Result
		if !validJSONObject(result) {
			result = mustJSON(map[string]any{"result": json.RawMessage(job.Result)})
		}
		_, err := db.FinishSpaceRun(ctx, payload.SpaceRunID, "completed", result, "")
		return err
	case AgentJobFailed:
		_, err := db.FinishSpaceRun(ctx, payload.SpaceRunID, "failed", mustJSON(map[string]string{"message": job.ErrorMessage}), job.ErrorCode)
		return err
	case AgentJobCanceled, AgentJobExpired:
		return db.spaceTx(ctx, func(tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `UPDATE space_runs SET state='canceled',canceled_at=NOW(),completed_at=NOW(),updated_at=NOW() WHERE id=$1 AND state IN ('queued','running','retrying','awaiting_approval')`, payload.SpaceRunID)
			return err
		})
	default:
		return db.spaceTx(ctx, func(tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `UPDATE space_runs SET state='running',progress=$2,updated_at=NOW() WHERE id=$1 AND state IN ('queued','running','retrying')`, payload.SpaceRunID, job.Progress)
			return err
		})
	}
}

func (db *Database) CancelSpaceRun(ctx context.Context, userID, runID string) (*SpaceRun, error) {
	out := &SpaceRun{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var spaceID, requester string
		if err := tx.QueryRowContext(ctx, `SELECT space_id,requesting_member_id FROM space_runs WHERE id=$1`, runID).Scan(&spaceID, &requester); err != nil {
			return err
		}
		if requester != userID {
			return ErrSpaceForbidden
		}
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionAgentsRun); err != nil {
			return err
		}
		if err := scanSpaceRun(tx.QueryRowContext(ctx, `UPDATE space_runs SET state='canceled',canceled_at=NOW(),completed_at=NOW(),updated_at=NOW() WHERE id=$1 AND state IN ('queued','running','awaiting_approval','retrying') RETURNING `+spaceRunColumns, runID), out); err != nil {
			return err
		}
		_, _ = tx.ExecContext(ctx, `UPDATE space_run_approvals SET state='canceled',decided_by_user_id=$1,decided_at=NOW() WHERE run_id=$2 AND state='pending'`, userID, runID)
		_, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "agent.run.canceled", runID, map[string]any{})
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) RetrySpaceRun(ctx context.Context, userID, runID string) (*SpaceRun, error) {
	previous, err := db.SpaceRun(ctx, userID, runID)
	if err != nil {
		return nil, err
	}
	if previous.RequestingMemberID != userID || previous.State != "failed" && previous.State != "canceled" {
		return nil, ErrSpaceForbidden
	}
	out := *previous
	out.ID, out.State, out.Progress = "run_"+uuid.NewString(), "retrying", 0
	out.Result, out.Outputs, out.Artifacts = json.RawMessage(`{}`), json.RawMessage(`{}`), json.RawMessage(`[]`)
	out.ErrorCode, out.ErrorMessage, out.RetryOfRunID = "", "", previous.ID
	out.CompletedAt, out.CanceledAt = nil, nil
	err = db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, previous.SpaceID, PermissionAgentsRun); err != nil {
			return err
		}
		workflow, err := loadWorkflowVersionTx(ctx, tx, previous.WorkflowVersionID)
		if err != nil {
			return err
		}
		if err := authorizeWorkflowRequirementsTx(ctx, tx, userID, previous.SpaceID, workflow.Metadata); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `INSERT INTO space_runs(id,space_id,resource_kind,resource_id,initiated_by_user_id,billing_user_id,trigger_kind,state,input,requesting_member_id,source_conversation_id,source_type,agent_id,workflow_identifier,workflow_version_id,workflow_version,capability_id,outputs,artifacts,retry_of_run_id)
			VALUES($1,$2,$3,$4,$5,$5,'retry','retrying',$6,$5,NULLIF($7,''),$8,NULLIF($9,''),$10,$11,$12,$13,'{}'::jsonb,'[]'::jsonb,$14) RETURNING created_at,updated_at`, out.ID, out.SpaceID, out.ResourceKind, out.ResourceID, userID, out.Input, out.SourceConversationID, out.SourceType, out.AgentID, out.WorkflowIdentifier, out.WorkflowVersionID, out.WorkflowVersion, out.CapabilityID, previous.ID).Scan(&out.CreatedAt, &out.UpdatedAt)
	})
	return &out, err
}

func (db *Database) RunApprovals(ctx context.Context, userID, runID string) ([]RunApproval, error) {
	if _, err := db.SpaceRun(ctx, userID, runID); err != nil {
		return nil, err
	}
	items := []RunApproval{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT id,run_id,requested_from_user_id,COALESCE(decided_by_user_id,''),action_summary,proposed_actions,state,created_at,decided_at,expires_at FROM space_run_approvals WHERE run_id=$1 AND requested_from_user_id=$2 ORDER BY created_at`, runID, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item RunApproval
			if err := rows.Scan(&item.ID, &item.RunID, &item.RequestedFromUserID, &item.DecidedByUserID, &item.ActionSummary, &item.ProposedActions, &item.State, &item.CreatedAt, &item.DecidedAt, &item.ExpiresAt); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) RunActions(ctx context.Context, userID, runID string) ([]RunAction, error) {
	if _, err := db.SpaceRun(ctx, userID, runID); err != nil {
		return nil, err
	}
	items := []RunAction{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT id,run_id,action_kind,summary,details,destructive,state,performed_at,created_at FROM space_run_actions WHERE run_id=$1 ORDER BY created_at`, runID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item RunAction
			if err := rows.Scan(&item.ID, &item.RunID, &item.ActionKind, &item.Summary, &item.Details, &item.Destructive, &item.State, &item.PerformedAt, &item.CreatedAt); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) RecordRunAction(ctx context.Context, runID, kind, summary string, details json.RawMessage, destructive bool, state string) error {
	if !validJSONObject(details) {
		details = json.RawMessage(`{}`)
	}
	if state == "" {
		state = "completed"
	}
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		var performed any
		if state == "completed" || state == "failed" {
			performed = time.Now().UTC()
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO space_run_actions(id,run_id,action_kind,summary,details,destructive,state,performed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, "runaction_"+uuid.NewString(), runID, kind, summary, details, destructive, state, performed)
		return err
	})
}

func (db *Database) PrivateAgentConversations(ctx context.Context, userID string) ([]PrivateAgentConversation, error) {
	items := []PrivateAgentConversation{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT c.id,c.space_id,c.owner_user_id,c.agent_id,a.name,c.title,c.created_at,c.updated_at FROM space_agent_conversations c JOIN space_agents a ON a.id=c.agent_id JOIN space_members m ON m.space_id=c.space_id AND m.user_id=$1 WHERE c.owner_user_id=$1 AND c.deleted_at IS NULL ORDER BY c.updated_at DESC`, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item PrivateAgentConversation
			if err := rows.Scan(&item.ID, &item.SpaceID, &item.OwnerUserID, &item.AgentID, &item.AgentName, &item.Title, &item.CreatedAt, &item.UpdatedAt); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) PrivateAgentConversationByID(ctx context.Context, userID, conversationID string) (*PrivateAgentConversation, error) {
	out := &PrivateAgentConversation{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `SELECT c.id,c.space_id,c.owner_user_id,c.agent_id,a.name,c.title,c.created_at,c.updated_at FROM space_agent_conversations c JOIN space_agents a ON a.id=c.agent_id WHERE c.id=$1 AND c.owner_user_id=$2 AND c.deleted_at IS NULL`, conversationID, userID).Scan(&out.ID, &out.SpaceID, &out.OwnerUserID, &out.AgentID, &out.AgentName, &out.Title, &out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		return requireSpacePermissionTx(ctx, tx, userID, out.SpaceID, PermissionAgentsRun)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}
