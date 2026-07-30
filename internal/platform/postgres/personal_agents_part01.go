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

var (
	ErrPersonalAgentNotFound = errors.New("personal agent not found")
	ErrPersonalAgentConflict = errors.New("personal agent version conflict")
	ErrPersonalAgentModel    = errors.New("personal agent model unavailable")
)

type PersonalAgent struct {
	ID                 string          `json:"id"`
	OwnerUserID        string          `json:"owner_user_id"`
	Name               string          `json:"name"`
	Description        string          `json:"description"`
	Icon               string          `json:"icon"`
	Instructions       string          `json:"instructions,omitempty"`
	ModelMode          string          `json:"model_mode"`
	ModelID            string          `json:"model_id,omitempty"`
	ReasoningEffort    string          `json:"reasoning_effort,omitempty"`
	ContextPermissions json.RawMessage `json:"context_permissions"`
	ToolPermissions    json.RawMessage `json:"tool_permissions"`
	Enabled            bool            `json:"enabled"`
	Version            int64           `json:"version"`
	CreatedAt          time.Time       `json:"created_at"`
	UpdatedAt          time.Time       `json:"updated_at"`
}

type PersonalAgentSpaceGrant struct {
	ID            string    `json:"id"`
	AgentID       string    `json:"agent_id"`
	SpaceID       string    `json:"space_id"`
	SpaceName     string    `json:"space_name"`
	AllMembers    bool      `json:"all_members"`
	MemberUserIDs []string  `json:"member_user_ids"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type PersonalAgentGrantInput struct {
	SpaceID       string   `json:"space_id"`
	AllMembers    bool     `json:"all_members"`
	MemberUserIDs []string `json:"member_user_ids"`
}

const personalAgentColumns = `id,owner_user_id,name,description,icon,instructions,model_mode,model_id,reasoning_effort,context_permissions,tool_permissions,enabled,version,created_at,updated_at`

func scanPersonalAgent(row scanner, out *PersonalAgent) error {
	return row.Scan(&out.ID, &out.OwnerUserID, &out.Name, &out.Description, &out.Icon, &out.Instructions,
		&out.ModelMode, &out.ModelID, &out.ReasoningEffort, &out.ContextPermissions, &out.ToolPermissions, &out.Enabled,
		&out.Version, &out.CreatedAt, &out.UpdatedAt)
}

func normalizePersonalAgent(agent *PersonalAgent) error {
	agent.Name = strings.TrimSpace(agent.Name)
	agent.Description = strings.TrimSpace(agent.Description)
	agent.Icon = strings.TrimSpace(agent.Icon)
	agent.Instructions = strings.TrimSpace(agent.Instructions)
	agent.ModelMode = strings.ToLower(strings.TrimSpace(agent.ModelMode))
	agent.ModelID = strings.TrimSpace(agent.ModelID)
	agent.ReasoningEffort = strings.ToLower(strings.TrimSpace(agent.ReasoningEffort))
	switch agent.ReasoningEffort {
	case "", "low", "medium", "high":
	default:
		agent.ReasoningEffort = ""
	}
	if agent.ModelMode == "" {
		agent.ModelMode = "pinned"
	}
	if len([]rune(agent.Name)) < 1 || len([]rune(agent.Name)) > 80 || len([]rune(agent.Description)) > 400 || len([]rune(agent.Instructions)) > 16_000 {
		return ErrSpaceInvalid
	}
	if agent.ModelMode != "pinned" || agent.ModelID == "" {
		return ErrSpaceInvalid
	}
	if !validPersonalJSONObject(agent.ContextPermissions) {
		// "task_notes" is the current name for the notes column on a task. Rows
		// stored under the old "notes" key still work; see the alias in
		// PersonalAgentSpaceContextForConversation.
		agent.ContextPermissions = json.RawMessage(`{"space_chat":true,"library":true,"task_notes":true,"tasks":true,"members":true}`)
	}
	if !validPersonalJSONObject(agent.ToolPermissions) {
		agent.ToolPermissions = json.RawMessage(`{"read":true,"write":false,"integrations":[]}`)
	}
	return nil
}

func validPersonalJSONObject(raw json.RawMessage) bool {
	var value map[string]any
	return len(raw) > 0 && json.Unmarshal(raw, &value) == nil && value != nil
}

func (db *Database) ListPersonalAgents(ctx context.Context, userID string) ([]PersonalAgent, error) {
	items := []PersonalAgent{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT `+personalAgentColumns+` FROM personal_agents WHERE owner_user_id=$1 AND deleted_at IS NULL ORDER BY lower(name),id`, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item PersonalAgent
			if err := scanPersonalAgent(rows, &item); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) PersonalAgentByID(ctx context.Context, userID, agentID string) (*PersonalAgent, error) {
	out := &PersonalAgent{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		err := scanPersonalAgent(tx.QueryRowContext(ctx, `SELECT `+personalAgentColumns+` FROM personal_agents WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, agentID, userID), out)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrPersonalAgentNotFound
		}
		return err
	})
	return out, err
}

func (db *Database) CreatePersonalAgent(ctx context.Context, userID string, item PersonalAgent) (*PersonalAgent, error) {
	item.OwnerUserID = userID
	item.ID = "personal_" + uuid.NewString()
	if err := normalizePersonalAgent(&item); err != nil {
		return nil, err
	}
	if !item.Enabled {
		item.Enabled = true
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		return scanPersonalAgent(tx.QueryRowContext(ctx, `INSERT INTO personal_agents(id,owner_user_id,name,description,icon,instructions,model_mode,model_id,reasoning_effort,context_permissions,tool_permissions,enabled)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING `+personalAgentColumns,
			item.ID, userID, item.Name, item.Description, item.Icon, item.Instructions, item.ModelMode, item.ModelID, item.ReasoningEffort, item.ContextPermissions, item.ToolPermissions, item.Enabled), &item)
	})
	return &item, err
}

func (db *Database) UpdatePersonalAgent(ctx context.Context, userID string, item PersonalAgent) (*PersonalAgent, error) {
	if item.ID == "" || item.Version < 1 {
		return nil, ErrSpaceInvalid
	}
	if err := normalizePersonalAgent(&item); err != nil {
		return nil, err
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		err := scanPersonalAgent(tx.QueryRowContext(ctx, `UPDATE personal_agents SET name=$1,description=$2,icon=$3,instructions=$4,model_mode=$5,model_id=$6,reasoning_effort=$7,context_permissions=$8,tool_permissions=$9,enabled=$10,version=version+1,updated_at=NOW()
			WHERE id=$11 AND owner_user_id=$12 AND version=$13 AND deleted_at IS NULL RETURNING `+personalAgentColumns,
			item.Name, item.Description, item.Icon, item.Instructions, item.ModelMode, item.ModelID, item.ReasoningEffort, item.ContextPermissions, item.ToolPermissions, item.Enabled, item.ID, userID, item.Version), &item)
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var exists bool
		if queryErr := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM personal_agents WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL)`, item.ID, userID).Scan(&exists); queryErr != nil {
			return queryErr
		}
		if exists {
			return ErrPersonalAgentConflict
		}
		return ErrPersonalAgentNotFound
	})
	return &item, err
}

func (db *Database) DeletePersonalAgent(ctx context.Context, userID, agentID string) error {
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `UPDATE personal_agents SET enabled=FALSE,deleted_at=NOW(),version=version+1,updated_at=NOW() WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, agentID, userID)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count == 0 {
			return ErrPersonalAgentNotFound
		}
		return nil
	})
}

func (db *Database) PersonalAgentGrants(ctx context.Context, userID, agentID string) ([]PersonalAgentSpaceGrant, error) {
	items := []PersonalAgentSpaceGrant{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var owner string
		if err := tx.QueryRowContext(ctx, `SELECT owner_user_id FROM personal_agents WHERE id=$1 AND deleted_at IS NULL`, agentID).Scan(&owner); errors.Is(err, sql.ErrNoRows) {
			return ErrPersonalAgentNotFound
		} else if err != nil {
			return err
		}
		if owner != userID {
			return ErrSpaceForbidden
		}
		rows, err := tx.QueryContext(ctx, `SELECT g.id,g.agent_id,g.space_id,s.name,g.all_members,g.created_at,g.updated_at FROM personal_agent_space_grants g JOIN spaces s ON s.id=g.space_id WHERE g.agent_id=$1 ORDER BY lower(s.name),g.id`, agentID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var item PersonalAgentSpaceGrant
			if err := rows.Scan(&item.ID, &item.AgentID, &item.SpaceID, &item.SpaceName, &item.AllMembers, &item.CreatedAt, &item.UpdatedAt); err != nil {
				rows.Close()
				return err
			}
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for index := range items {
			item := &items[index]
			memberRows, err := tx.QueryContext(ctx, `SELECT user_id FROM personal_agent_member_grants WHERE grant_id=$1 ORDER BY user_id`, item.ID)
			if err != nil {
				return err
			}
			for memberRows.Next() {
				var id string
				if err := memberRows.Scan(&id); err != nil {
					memberRows.Close()
					return err
				}
				item.MemberUserIDs = append(item.MemberUserIDs, id)
			}
			if err := memberRows.Close(); err != nil {
				return err
			}
		}
		return nil
	})
	return items, err
}
