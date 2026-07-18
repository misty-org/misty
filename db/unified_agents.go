package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	workflowv2 "github.com/kannachi323/misty/server/workflow"
)

type AgentVersionWorkflow struct {
	WorkflowVersionID string `json:"workflow_version_id"`
	Alias             string `json:"alias"`
	Enabled           bool   `json:"enabled"`
	Position          int    `json:"position"`
}

type PublishedAgentVersion struct {
	ID           string                       `json:"id"`
	AgentID      string                       `json:"agent_id"`
	SpaceID      string                       `json:"space_id"`
	CreatorID    string                       `json:"creator_user_id"`
	Version      int                          `json:"version"`
	Name         string                       `json:"name"`
	Description  string                       `json:"description"`
	Icon         string                       `json:"icon"`
	Instructions string                       `json:"instructions"`
	Access       workflowv2.AgentAccessPolicy `json:"access"`
	Workflows    []AgentVersionWorkflow       `json:"workflows"`
	Checksum     string                       `json:"checksum_sha256"`
	PublishedAt  time.Time                    `json:"published_at"`
}

type AgentInstanceRecord struct {
	ID                 string                   `json:"id"`
	SpaceID            string                   `json:"space_id"`
	AgentID            string                   `json:"agent_id"`
	UserID             string                   `json:"user_id"`
	AgentVersionID     string                   `json:"agent_version_id"`
	Status             string                   `json:"status"`
	UpdateAvailable    bool                     `json:"update_available"`
	ConnectionBindings map[string]string        `json:"connection_bindings"`
	CapabilityGrants   json.RawMessage          `json:"capability_grants"`
	Workflows          []InstanceWorkflowConfig `json:"workflows"`
	CreatedAt          time.Time                `json:"created_at"`
	UpdatedAt          time.Time                `json:"updated_at"`
}

type InstanceWorkflowConfig struct {
	WorkflowVersionID string          `json:"workflow_version_id"`
	Enabled           bool            `json:"enabled"`
	TriggerConfig     json.RawMessage `json:"trigger_config"`
	Consent           json.RawMessage `json:"consent"`
	Cursor            json.RawMessage `json:"cursor"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

func (db *Database) PublishAgentVersion(ctx context.Context, userID, spaceID, agentID string, workflows []AgentVersionWorkflow) (*PublishedAgentVersion, error) {
	out := &PublishedAgentVersion{ID: "agentver_" + uuid.NewString(), AgentID: agentID, SpaceID: spaceID, CreatorID: userID, Workflows: workflows}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var accessRaw []byte
		if err := tx.QueryRowContext(ctx, `SELECT name,description,icon,instructions,access_policy FROM space_agents WHERE id=$1 AND space_id=$2 AND creator_user_id=$3`, agentID, spaceID, userID).Scan(&out.Name, &out.Description, &out.Icon, &out.Instructions, &accessRaw); err != nil {
			return err
		}
		if json.Unmarshal(accessRaw, &out.Access) != nil || !validAgentAccess(out.Access) {
			return ErrSpaceInvalid
		}
		seenAlias, seenVersion := map[string]bool{}, map[string]bool{}
		for index := range workflows {
			item := &workflows[index]
			item.Alias = strings.TrimSpace(item.Alias)
			if !validWorkflowToken(item.Alias, 80) || seenAlias[item.Alias] || seenVersion[item.WorkflowVersionID] {
				return ErrSpaceInvalid
			}
			seenAlias[item.Alias], seenVersion[item.WorkflowVersionID] = true, true
			var exists bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_workflow_versions WHERE id=$1 AND space_id=$2)`, item.WorkflowVersionID, spaceID).Scan(&exists); err != nil || !exists {
				return ErrSpaceInvalid
			}
			item.Position = index
		}
		out.Workflows = workflows
		var next int
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version),0)+1 FROM space_agent_versions WHERE agent_id=$1`, agentID).Scan(&next); err != nil {
			return err
		}
		out.Version = next
		accessRaw, _ = json.Marshal(out.Access)
		checksumInput, _ := json.Marshal(map[string]any{"agent": agentID, "version": next, "name": out.Name, "description": out.Description, "icon": out.Icon, "instructions": out.Instructions, "access": out.Access, "workflows": workflows})
		digest := sha256.Sum256(checksumInput)
		out.Checksum = hex.EncodeToString(digest[:])
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_agent_versions(id,agent_id,space_id,creator_user_id,version,name,description,icon,instructions,access_policy,checksum_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING published_at`, out.ID, agentID, spaceID, userID, next, out.Name, out.Description, out.Icon, out.Instructions, accessRaw, out.Checksum).Scan(&out.PublishedAt); err != nil {
			return err
		}
		for _, item := range workflows {
			if _, err := tx.ExecContext(ctx, `INSERT INTO space_agent_version_workflows(agent_version_id,workflow_version_id,alias,enabled,position) VALUES($1,$2,$3,$4,$5)`, out.ID, item.WorkflowVersionID, item.Alias, item.Enabled, item.Position); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_agents SET published_agent_version_id=$1,updated_at=NOW(),updated_by_user_id=$2 WHERE id=$3`, out.ID, userID, agentID); err != nil {
			return err
		}
		_, err := recordSpaceEventTx(ctx, tx, spaceID, userID, "agent.version.published", agentID, map[string]any{"agent_version_id": out.ID, "version": next})
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceForbidden
	}
	return out, err
}

func validAgentAccess(access workflowv2.AgentAccessPolicy) bool {
	if access.Mode != "space" && access.Mode != "selected" {
		return false
	}
	if access.Mode == "selected" && len(access.AllowedUserIDs) == 0 {
		return false
	}
	seen := map[string]bool{}
	for _, id := range access.AllowedUserIDs {
		if strings.TrimSpace(id) == "" || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}

func (db *Database) EnsureAgentInstance(ctx context.Context, userID, spaceID, agentID string) (*AgentInstanceRecord, error) {
	out := &AgentInstanceRecord{ConnectionBindings: map[string]string{}, CapabilityGrants: json.RawMessage(`[]`)}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionAgentsRun); err != nil {
			return err
		}
		var creatorID, versionID string
		if err := tx.QueryRowContext(ctx, `SELECT creator_user_id,COALESCE(published_agent_version_id,'') FROM space_agents WHERE id=$1 AND space_id=$2 AND enabled AND status='available'`, agentID, spaceID).Scan(&creatorID, &versionID); err != nil {
			return err
		}
		if versionID == "" {
			return ErrSpaceInvalid
		}
		var pinnedVersionID string
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE((SELECT agent_version_id FROM space_agent_instances WHERE agent_id=$1 AND user_id=$2),'')`, agentID, userID).Scan(&pinnedVersionID); err != nil {
			return err
		}
		if pinnedVersionID != "" {
			versionID = pinnedVersionID
		}
		var accessRaw []byte
		if err := tx.QueryRowContext(ctx, `SELECT access_policy FROM space_agent_versions WHERE id=$1 AND agent_id=$2`, versionID, agentID).Scan(&accessRaw); err != nil {
			return err
		}
		var access workflowv2.AgentAccessPolicy
		if json.Unmarshal(accessRaw, &access) != nil || !agentAccessAllows(access, creatorID, userID) {
			return ErrSpaceForbidden
		}
		out.ID = "agentinst_" + uuid.NewString()
		var bindingsRaw []byte
		if err := tx.QueryRowContext(ctx, `INSERT INTO space_agent_instances(id,space_id,agent_id,user_id,agent_version_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(agent_id,user_id) DO UPDATE SET updated_at=space_agent_instances.updated_at RETURNING id,space_id,agent_id,user_id,agent_version_id,connection_bindings,capability_grants,created_at,updated_at`, out.ID, spaceID, agentID, userID, versionID).Scan(&out.ID, &out.SpaceID, &out.AgentID, &out.UserID, &out.AgentVersionID, &bindingsRaw, &out.CapabilityGrants, &out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		_ = json.Unmarshal(bindingsRaw, &out.ConnectionBindings)
		return hydrateAgentInstanceState(ctx, tx, out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func agentAccessAllows(access workflowv2.AgentAccessPolicy, creatorID, userID string) bool {
	if creatorID == userID || access.Mode == "space" {
		return true
	}
	for _, candidate := range access.AllowedUserIDs {
		if candidate == userID {
			return true
		}
	}
	return false
}

func hydrateAgentInstanceState(ctx context.Context, tx *sql.Tx, out *AgentInstanceRecord) error {
	var active int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM space_runs WHERE agent_instance_id=$1 AND state IN ('queued','running','cooldown','awaiting_approval')`, out.ID).Scan(&active); err != nil {
		return err
	}
	out.Status = "idle"
	if active > 0 {
		out.Status = "running"
	}
	var published string
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(published_agent_version_id,'') FROM space_agents WHERE id=$1`, out.AgentID).Scan(&published); err != nil {
		return err
	}
	out.UpdateAvailable = published != "" && published != out.AgentVersionID
	out.Workflows = []InstanceWorkflowConfig{}
	rows, err := tx.QueryContext(ctx, `SELECT workflow_version_id,enabled,trigger_config,consent,cursor,updated_at FROM space_agent_instance_workflows WHERE instance_id=$1 ORDER BY workflow_version_id`, out.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item InstanceWorkflowConfig
		if err := rows.Scan(&item.WorkflowVersionID, &item.Enabled, &item.TriggerConfig, &item.Consent, &item.Cursor, &item.UpdatedAt); err != nil {
			return err
		}
		out.Workflows = append(out.Workflows, item)
	}
	return rows.Err()
}

func (db *Database) UpdateAgentInstance(ctx context.Context, userID, instanceID string) (*AgentInstanceRecord, error) {
	out := &AgentInstanceRecord{ConnectionBindings: map[string]string{}}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "agent-instance:"+instanceID); err != nil {
			return err
		}
		var bindingsRaw []byte
		if err := tx.QueryRowContext(ctx, `SELECT id,space_id,agent_id,user_id,agent_version_id,connection_bindings,capability_grants,created_at,updated_at FROM space_agent_instances WHERE id=$1 AND user_id=$2 FOR UPDATE`, instanceID, userID).Scan(&out.ID, &out.SpaceID, &out.AgentID, &out.UserID, &out.AgentVersionID, &bindingsRaw, &out.CapabilityGrants, &out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		_ = json.Unmarshal(bindingsRaw, &out.ConnectionBindings)
		if err := hydrateAgentInstanceState(ctx, tx, out); err != nil {
			return err
		}
		if out.Status != "idle" {
			return ErrSpaceConflict
		}
		var published string
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(published_agent_version_id,'') FROM space_agents WHERE id=$1`, out.AgentID).Scan(&published); err != nil {
			return err
		}
		if published == "" || published == out.AgentVersionID {
			return nil
		}
		if _, err := tx.ExecContext(ctx, `UPDATE space_agent_instances SET agent_version_id=$1,capability_grants='[]'::jsonb,updated_at=NOW() WHERE id=$2`, published, instanceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM space_agent_instance_workflows w WHERE instance_id=$1 AND NOT EXISTS(SELECT 1 FROM space_agent_version_workflows a WHERE a.agent_version_id=$2 AND a.workflow_version_id=w.workflow_version_id AND a.enabled)`, instanceID, published); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO space_agent_instance_workflows(instance_id,workflow_version_id,enabled,trigger_config,consent)
			SELECT $1,workflow_version_id,FALSE,'{}'::jsonb,'{}'::jsonb FROM space_agent_version_workflows WHERE agent_version_id=$2 AND enabled
			ON CONFLICT(instance_id,workflow_version_id) DO UPDATE SET enabled=FALSE,consent='{}'::jsonb,updated_at=NOW()`, instanceID, published); err != nil {
			return err
		}
		out.AgentVersionID, out.CapabilityGrants, out.UpdateAvailable, out.UpdatedAt = published, json.RawMessage(`[]`), false, time.Now().UTC()
		return hydrateAgentInstanceState(ctx, tx, out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) ConfigureInstanceWorkflow(ctx context.Context, userID, instanceID, workflowVersionID string, enabled bool, triggerConfig, consent json.RawMessage) (*InstanceWorkflowConfig, error) {
	if !validJSONObject(triggerConfig) || !validJSONObject(consent) {
		return nil, ErrSpaceInvalid
	}
	out := &InstanceWorkflowConfig{WorkflowVersionID: workflowVersionID, Enabled: enabled, TriggerConfig: triggerConfig, Consent: consent, Cursor: json.RawMessage(`{}`)}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var agentVersionID string
		if err := tx.QueryRowContext(ctx, `SELECT agent_version_id FROM space_agent_instances WHERE id=$1 AND user_id=$2`, instanceID, userID).Scan(&agentVersionID); err != nil {
			return err
		}
		var attached bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_agent_version_workflows WHERE agent_version_id=$1 AND workflow_version_id=$2 AND enabled)`, agentVersionID, workflowVersionID).Scan(&attached); err != nil || !attached {
			return ErrSpaceInvalid
		}
		return tx.QueryRowContext(ctx, `INSERT INTO space_agent_instance_workflows(instance_id,workflow_version_id,enabled,trigger_config,consent) VALUES($1,$2,$3,$4,$5) ON CONFLICT(instance_id,workflow_version_id) DO UPDATE SET enabled=EXCLUDED.enabled,trigger_config=EXCLUDED.trigger_config,consent=EXCLUDED.consent,updated_at=NOW() RETURNING cursor,updated_at`, instanceID, workflowVersionID, enabled, triggerConfig, consent).Scan(&out.Cursor, &out.UpdatedAt)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) UpdateAgentInstanceConnections(ctx context.Context, userID, instanceID string, bindings map[string]string) (*AgentInstanceRecord, error) {
	if bindings == nil {
		bindings = map[string]string{}
	}
	for provider, connectionID := range bindings {
		if !validWorkflowToken(provider, 120) || strings.TrimSpace(connectionID) == "" {
			return nil, ErrSpaceInvalid
		}
	}
	raw, _ := json.Marshal(bindings)
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var spaceID string
		if err := tx.QueryRowContext(ctx, `SELECT space_id FROM space_agent_instances WHERE id=$1 AND user_id=$2`, instanceID, userID).Scan(&spaceID); err != nil {
			return err
		}
		for _, connectionID := range bindings {
			var valid bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_integrations WHERE id=$1 AND space_id=$2 AND connected_by_user_id=$3 AND status='active')`, connectionID, spaceID, userID).Scan(&valid); err != nil || !valid {
				return ErrSpaceInvalid
			}
		}
		_, err := tx.ExecContext(ctx, `UPDATE space_agent_instances SET connection_bindings=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3`, raw, instanceID, userID)
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	if err != nil {
		return nil, err
	}
	return db.agentInstanceByID(ctx, userID, instanceID)
}

func (db *Database) agentInstanceByID(ctx context.Context, userID, instanceID string) (*AgentInstanceRecord, error) {
	out := &AgentInstanceRecord{ConnectionBindings: map[string]string{}}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var bindingsRaw []byte
		if err := tx.QueryRowContext(ctx, `SELECT id,space_id,agent_id,user_id,agent_version_id,connection_bindings,capability_grants,created_at,updated_at FROM space_agent_instances WHERE id=$1 AND user_id=$2`, instanceID, userID).Scan(&out.ID, &out.SpaceID, &out.AgentID, &out.UserID, &out.AgentVersionID, &bindingsRaw, &out.CapabilityGrants, &out.CreatedAt, &out.UpdatedAt); err != nil {
			return err
		}
		_ = json.Unmarshal(bindingsRaw, &out.ConnectionBindings)
		return hydrateAgentInstanceState(ctx, tx, out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) PublishedAgentVersions(ctx context.Context, userID, spaceID, agentID string) ([]PublishedAgentVersion, error) {
	items := []PublishedAgentVersion{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT id,agent_id,space_id,creator_user_id,version,name,description,icon,instructions,access_policy,checksum_sha256,published_at FROM space_agent_versions WHERE space_id=$1 AND agent_id=$2 ORDER BY version DESC`, spaceID, agentID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item PublishedAgentVersion
			var accessRaw []byte
			if err := rows.Scan(&item.ID, &item.AgentID, &item.SpaceID, &item.CreatorID, &item.Version, &item.Name, &item.Description, &item.Icon, &item.Instructions, &accessRaw, &item.Checksum, &item.PublishedAt); err != nil {
				return err
			}
			_ = json.Unmarshal(accessRaw, &item.Access)
			item.Workflows = []AgentVersionWorkflow{}
			child, err := tx.QueryContext(ctx, `SELECT workflow_version_id,alias,enabled,position FROM space_agent_version_workflows WHERE agent_version_id=$1 ORDER BY position,alias`, item.ID)
			if err != nil {
				return err
			}
			for child.Next() {
				var attached AgentVersionWorkflow
				if err := child.Scan(&attached.WorkflowVersionID, &attached.Alias, &attached.Enabled, &attached.Position); err != nil {
					child.Close()
					return err
				}
				item.Workflows = append(item.Workflows, attached)
			}
			if err := child.Close(); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	sort.SliceStable(items, func(i, j int) bool { return items[i].Version > items[j].Version })
	return items, err
}
