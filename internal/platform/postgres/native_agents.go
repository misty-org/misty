package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
)

type AgentAppAssignmentInput struct {
	SpaceID string   `json:"space_id"`
	AppIDs  []string `json:"app_ids"`
}

type AgentProfileInput struct {
	Assignment      *AgentAppAssignmentInput `json:"assignment,omitempty"`
	Name            string                   `json:"name"`
	Role            string                   `json:"role"`
	Description     string                   `json:"description"`
	Instructions    string                   `json:"instructions"`
	Icon            string                   `json:"icon"`
	Avatar          json.RawMessage          `json:"avatar"`
	ModelMode       string                   `json:"model_mode"`
	ModelID         string                   `json:"model_id"`
	ReasoningEffort string                   `json:"reasoning_effort"`
	Enabled         bool                     `json:"enabled"`
	Version         int64                    `json:"version,omitempty"`
}

func (db *Database) PersonalAgents(ctx context.Context, userID string) ([]AskIdentity, error) {
	items := []AskIdentity{}
	err := db.TestingWithRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT `+personalAgentColumns+` FROM misty_ask_identities WHERE owner_user_id=$1 AND deleted_at IS NULL ORDER BY system_managed DESC,created_at,id`, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item AskIdentity
			if err := scanPersonalAgent(rows, &item); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) SavePersonalAgent(ctx context.Context, userID, id string, input AgentProfileInput) (*AskIdentity, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Role = strings.TrimSpace(input.Role)
	if input.Name == "" || len([]rune(input.Name)) > 80 || len([]rune(input.Role)) > 160 || len(input.Description) > 8000 || len(input.Instructions) > 64000 || len(input.Icon) > 128 || len(input.ModelID) > 200 || len(input.ReasoningEffort) > 32 {
		return nil, ErrSpaceInvalid
	}
	if input.ModelMode == "" {
		input.ModelMode = "automatic"
	}
	if input.ModelMode != "automatic" && input.ModelMode != "pinned" || input.ModelMode == "pinned" && input.ModelID == "" {
		return nil, ErrSpaceInvalid
	}
	if len(input.Avatar) == 0 {
		input.Avatar = json.RawMessage(`{}`)
	}
	if !validPersonalJSONObject(input.Avatar) || len(input.Avatar) > 4096 {
		return nil, ErrSpaceInvalid
	}
	out := &AskIdentity{}
	err := db.TestingWithRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		if id == "" {
			id = "personal_" + uuid.NewString()
			if err := scanPersonalAgent(tx.QueryRowContext(ctx, `INSERT INTO misty_ask_identities(id,owner_user_id,name,role,description,instructions,icon,avatar,model_mode,model_id,reasoning_effort,enabled,system_managed,default_run_mode,voice_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE,'ask','alloy') RETURNING `+personalAgentColumns, id, userID, input.Name, input.Role, input.Description, input.Instructions, input.Icon, input.Avatar, input.ModelMode, input.ModelID, input.ReasoningEffort, input.Enabled), out); err != nil {
				return err
			}
		} else {
			err := scanPersonalAgent(tx.QueryRowContext(ctx, `SELECT `+personalAgentColumns+` FROM misty_ask_identities WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL FOR UPDATE`, id, userID), out)
			if errors.Is(err, sql.ErrNoRows) {
				return ErrPersonalAgentNotFound
			}
			if err != nil {
				return err
			}
			if input.Version != out.Version {
				return ErrPersonalAgentConflict
			}
			if out.SystemManaged && (!input.Enabled || input.Name != "Misty") {
				return ErrSpaceInvalid
			}
			if err := scanPersonalAgent(tx.QueryRowContext(ctx, `UPDATE misty_ask_identities SET name=$3,role=$4,description=$5,instructions=$6,icon=$7,avatar=$8,model_mode=$9,model_id=$10,reasoning_effort=$11,enabled=$12,version=version+1,updated_at=NOW() WHERE id=$1 AND owner_user_id=$2 RETURNING `+personalAgentColumns, id, userID, input.Name, input.Role, input.Description, input.Instructions, input.Icon, input.Avatar, input.ModelMode, input.ModelID, input.ReasoningEffort, input.Enabled), out); err != nil {
				return err
			}
			if !input.Enabled {
				if err := cancelPersonalAgentRunsTx(ctx, tx, id, "agent_disabled"); err != nil {
					return err
				}
			}
		}
		if _, err := insertPersonalAgentVersionTx(ctx, tx, *out, userID); err != nil {
			return err
		}
		if input.Assignment != nil {
			return setAgentAppAssignmentsTx(ctx, tx, userID, id, input.Assignment.SpaceID, input.Assignment.AppIDs)
		}
		return nil
	})
	return out, err
}

func (db *Database) DeletePersonalAgent(ctx context.Context, userID, id string) error {
	return db.TestingWithRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `UPDATE misty_ask_identities SET deleted_at=NOW(),enabled=FALSE,updated_at=NOW() WHERE id=$1 AND owner_user_id=$2 AND NOT system_managed AND deleted_at IS NULL`, id, userID)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrPersonalAgentNotFound
		}
		return cancelPersonalAgentRunsTx(ctx, tx, id, "agent_deleted")
	})
}

func (db *Database) AgentAppAssignments(ctx context.Context, userID, agentID, spaceID string) ([]string, error) {
	items := []string{}
	err := db.TestingWithRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		if err := requirePersonalAgentSpaceTx(ctx, tx, userID, "", agentID); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT a.app_id FROM misty_agent_app_assignments a JOIN user_app_installations i ON i.user_id=a.owner_user_id AND i.app_id=a.app_id AND i.state='installed' AND NOT i.consent_required WHERE a.agent_id=$1 AND a.owner_user_id=$2 ORDER BY a.app_id`, agentID, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			items = append(items, id)
		}
		return rows.Err()
	})
	return items, err
}

func requirePersonalAgentSpaceTx(ctx context.Context, tx *sql.Tx, userID, spaceID, agentID string) error {
	if spaceID != "" {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM misty_ask_identities WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL)`, agentID, userID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrPersonalAgentNotFound
	}
	return nil
}
func (db *Database) SetAgentAppAssignments(ctx context.Context, userID, agentID, spaceID string, appIDs []string) error {
	return db.TestingWithRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error { return setAgentAppAssignmentsTx(ctx, tx, userID, agentID, spaceID, appIDs) })
}
func setAgentAppAssignmentsTx(ctx context.Context, tx *sql.Tx, userID, agentID, spaceID string, appIDs []string) error {
	if len(appIDs) > 200 {
		return ErrSpaceInvalid
	}
	if err := requirePersonalAgentSpaceTx(ctx, tx, userID, "", agentID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "agent-apps:"+userID+":"+agentID); err != nil {
		return err
	}
	for _, id := range appIDs {
		if id == "agents" || len(id) > 128 {
			return ErrSpaceInvalid
		}
		if err := requireUserAppTx(ctx, tx, userID, id); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM misty_agent_app_assignments WHERE agent_id=$1 AND owner_user_id=$2 `, agentID, userID); err != nil {
		return err
	}
	for _, id := range appIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO misty_agent_app_assignments(agent_id,owner_user_id,space_id,app_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, agentID, userID, "", id); err != nil {
			return err
		}
	}
	return nil
}

// Binding is immutable. A legacy NULL identity can only be claimed by default Misty.
func (db *Database) BindConversationAgent(ctx context.Context, userID, conversationID, agentID string) error {
	return db.TestingWithRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		var managed bool
		if err := tx.QueryRowContext(ctx, `SELECT system_managed FROM misty_ask_identities WHERE id=$1 AND owner_user_id=$2 AND enabled AND deleted_at IS NULL`, agentID, userID).Scan(&managed); err != nil {
			return ErrPersonalAgentNotFound
		}
		result, err := tx.ExecContext(ctx, `UPDATE misty_ask_conversations SET agent_id=$3 WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL AND (agent_id=$3 OR (agent_id IS NULL AND $4))`, conversationID, userID, agentID, managed)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrSpaceConflict
		}
		return nil
	})
}

func (db *Database) CreatePersonalAgentConversation(ctx context.Context, userID, spaceID, agentID string) (string, error) {
	if _, err := db.AskExecutionContext(ctx, userID, spaceID, agentID); err != nil {
		return "", err
	}
	id := "conversation_" + uuid.NewString()
	err := db.TestingWithRLSContext(ctx, userRLSSettings(userID), func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO misty_ask_conversations(id,user_id,state,active_until,retention_expires_at,space_id,agent_id) VALUES($1,$2,'{}',NOW()+INTERVAL '30 days',NOW()+INTERVAL '30 days',NULLIF($3,''),$4)`, id, userID, spaceID, agentID)
		return err
	})
	return id, err
}
