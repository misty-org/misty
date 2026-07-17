package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type WorkflowField struct {
	Name        string          `json:"name"`
	Type        string          `json:"type"`
	Description string          `json:"description,omitempty"`
	Required    bool            `json:"required,omitempty"`
	Schema      json.RawMessage `json:"schema,omitempty"`
}

type WorkflowCapability struct {
	ID                   string          `json:"id"`
	Name                 string          `json:"name"`
	Description          string          `json:"description"`
	Inputs               []WorkflowField `json:"inputs"`
	Outputs              []WorkflowField `json:"outputs"`
	ReadOnly             bool            `json:"readOnly"`
	Destructive          bool            `json:"destructive"`
	ConfirmationRequired bool            `json:"confirmationRequired"`
	Tags                 []string        `json:"tags"`
}

type WorkflowRuntime struct {
	Kind          string `json:"kind"`
	Compatibility string `json:"compatibility"`
}

type WorkflowMetadata struct {
	Capabilities         []WorkflowCapability `json:"capabilities"`
	RequiredIntegrations []string             `json:"requiredIntegrations"`
	RequiredPermissions  []string             `json:"requiredPermissions"`
	Runtime              WorkflowRuntime      `json:"runtime"`
	Tags                 []string             `json:"tags"`
}

type SuggestedAgentPreset struct {
	Name         string `json:"name"`
	Icon         string `json:"icon"`
	Description  string `json:"description"`
	Instructions string `json:"instructions"`
}

type WorkflowVersion struct {
	ID               string           `json:"id"`
	WorkflowID       string           `json:"workflow_id"`
	SpaceID          string           `json:"space_id"`
	StableIdentifier string           `json:"stable_identifier"`
	Version          string           `json:"version"`
	Name             string           `json:"name"`
	Description      string           `json:"description"`
	AuthorName       string           `json:"author_name"`
	Metadata         WorkflowMetadata `json:"metadata"`
	Definition       json.RawMessage  `json:"definition"`
	ChecksumSHA256   string           `json:"checksum_sha256"`
	CreatedByUserID  string           `json:"created_by_user_id"`
	CreatedAt        time.Time        `json:"created_at"`
}

type SpaceIntegration struct {
	ID                  string    `json:"id"`
	SpaceID             string    `json:"space_id"`
	Provider            string    `json:"provider"`
	DisplayName         string    `json:"display_name"`
	CredentialReference string    `json:"-"`
	GrantedPermissions  []string  `json:"granted_permissions"`
	Status              string    `json:"status"`
	ConnectedByUserID   string    `json:"connected_by_user_id"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

const workflowVersionColumns = `v.id,v.workflow_id,v.space_id,v.stable_identifier,v.version,v.name,v.description,v.author_name,v.metadata,v.definition,v.checksum_sha256,v.created_by_user_id,v.created_at`
const workflowVersionReturningColumns = `id,workflow_id,space_id,stable_identifier,version,name,description,author_name,metadata,definition,checksum_sha256,created_by_user_id,created_at`

func ValidateWorkflowMetadata(metadata WorkflowMetadata) error {
	if len(metadata.Capabilities) == 0 || len(metadata.Capabilities) > 100 {
		return ErrSpaceInvalid
	}
	seen := map[string]bool{}
	for _, capability := range metadata.Capabilities {
		if !validWorkflowToken(capability.ID, 100) || strings.TrimSpace(capability.Name) == "" || len([]rune(capability.Name)) > 160 || seen[capability.ID] {
			return ErrSpaceInvalid
		}
		seen[capability.ID] = true
		if capability.Destructive && !capability.ConfirmationRequired {
			return ErrSpaceInvalid
		}
		if err := validateWorkflowFields(capability.Inputs); err != nil {
			return err
		}
		if err := validateWorkflowFields(capability.Outputs); err != nil {
			return err
		}
	}
	if !validWorkflowToken(metadata.Runtime.Kind, 100) || strings.TrimSpace(metadata.Runtime.Compatibility) == "" {
		return ErrSpaceInvalid
	}
	for _, permission := range metadata.RequiredPermissions {
		if !validWorkflowToken(permission, 120) || !knownWorkflowPermission(permission) {
			return ErrSpaceInvalid
		}
	}
	for _, integration := range metadata.RequiredIntegrations {
		if !validWorkflowToken(integration, 120) {
			return ErrSpaceInvalid
		}
	}
	return nil
}

func knownWorkflowPermission(permission string) bool {
	if permission == "files.read" || permission == "files.write" {
		return true
	}
	for _, candidate := range configurableSpacePermissions {
		if permission == candidate {
			return true
		}
	}
	return false
}

func validateWorkflowFields(fields []WorkflowField) error {
	if len(fields) > 100 {
		return ErrSpaceInvalid
	}
	seen := map[string]bool{}
	for _, field := range fields {
		if !validWorkflowToken(field.Name, 100) || !validWorkflowToken(field.Type, 60) || seen[field.Name] {
			return ErrSpaceInvalid
		}
		seen[field.Name] = true
		if len(field.Schema) > 0 {
			var value any
			if json.Unmarshal(field.Schema, &value) != nil {
				return ErrSpaceInvalid
			}
		}
	}
	return nil
}

func validWorkflowToken(value string, maximum int) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maximum {
		return false
	}
	for _, character := range value {
		if !(character == '-' || character == '_' || character == '.' || character >= '0' && character <= '9' || character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z') {
			return false
		}
	}
	return true
}

func (db *Database) WorkflowVersions(ctx context.Context, userID, spaceID, workflowID string) ([]WorkflowVersion, error) {
	items := []WorkflowVersion{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStudioView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT `+workflowVersionColumns+` FROM space_workflow_versions v WHERE v.space_id=$1 AND ($2='' OR v.workflow_id=$2) ORDER BY v.created_at DESC`, spaceID, workflowID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item WorkflowVersion
			if err := scanWorkflowVersion(rows, &item); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) WorkflowVersion(ctx context.Context, userID, spaceID, versionID string) (*WorkflowVersion, error) {
	out := &WorkflowVersion{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStudioView); err != nil {
			return err
		}
		return scanWorkflowVersion(tx.QueryRowContext(ctx, `SELECT `+workflowVersionColumns+` FROM space_workflow_versions v WHERE v.id=$1 AND v.space_id=$2`, versionID, spaceID), out)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) CreateWorkflowVersion(ctx context.Context, userID, spaceID, workflowID, version string, metadata WorkflowMetadata, definition json.RawMessage) (*WorkflowVersion, error) {
	version = strings.TrimSpace(version)
	if !validWorkflowToken(version, 64) || ValidateWorkflowMetadata(metadata) != nil || !validJSONObject(definition) {
		return nil, ErrSpaceInvalid
	}
	metadataRaw, _ := json.Marshal(metadata)
	digest := sha256.Sum256(append(append([]byte{}, metadataRaw...), definition...))
	checksum := hex.EncodeToString(digest[:])
	out := &WorkflowVersion{ID: "wfver_" + uuid.NewString(), SpaceID: spaceID, WorkflowID: workflowID, Version: version, Metadata: metadata, Definition: definition, ChecksumSHA256: checksum, CreatedByUserID: userID}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStudioManage); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `SELECT stable_identifier,name,description,author_name FROM space_workflows WHERE id=$1 AND space_id=$2`, workflowID, spaceID).Scan(&out.StableIdentifier, &out.Name, &out.Description, &out.AuthorName); err != nil {
			return err
		}
		err := scanWorkflowVersion(tx.QueryRowContext(ctx, `INSERT INTO space_workflow_versions(id,workflow_id,space_id,stable_identifier,version,name,description,author_name,metadata,definition,checksum_sha256,created_by_user_id)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING `+workflowVersionReturningColumns,
			out.ID, workflowID, spaceID, out.StableIdentifier, version, out.Name, out.Description, out.AuthorName, metadataRaw, definition, checksum, userID), out)
		if err == nil {
			_, err = tx.ExecContext(ctx, `UPDATE space_workflows SET definition=$1,version=version+1,updated_at=NOW() WHERE id=$2`, definition, workflowID)
		}
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSpaceNotFound
	}
	return out, err
}

func (db *Database) ReplaceAgentWorkflow(ctx context.Context, userID, spaceID, agentID, versionID string) (*SpaceStudioResource, error) {
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStudioManage); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE space_agents a SET active_workflow_version_id=$1,updated_by_user_id=$2,version=version+1,updated_at=NOW()
			WHERE a.id=$3 AND a.space_id=$4 AND EXISTS(SELECT 1 FROM space_workflow_versions v WHERE v.id=$1 AND v.space_id=a.space_id)`, versionID, userID, agentID, spaceID)
		if err != nil {
			return err
		}
		if changed, _ := result.RowsAffected(); changed == 0 {
			return ErrSpaceNotFound
		}
		_, err = recordSpaceEventTx(ctx, tx, spaceID, userID, "agent.workflow.replaced", agentID, map[string]string{"workflow_version_id": versionID})
		return err
	})
	if err != nil {
		return nil, err
	}
	return db.SpaceStudioResourceByID(ctx, userID, spaceID, "agent", agentID)
}

func (db *Database) SpaceIntegrations(ctx context.Context, userID, spaceID string) ([]SpaceIntegration, error) {
	items := []SpaceIntegration{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStudioView); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT id,space_id,provider,display_name,'',granted_permissions,status,connected_by_user_id,created_at,updated_at FROM space_integrations WHERE space_id=$1 ORDER BY provider,display_name`, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item SpaceIntegration
			var permissionsRaw []byte
			if err := rows.Scan(&item.ID, &item.SpaceID, &item.Provider, &item.DisplayName, &item.CredentialReference, &permissionsRaw, &item.Status, &item.ConnectedByUserID, &item.CreatedAt, &item.UpdatedAt); err != nil {
				return err
			}
			_ = json.Unmarshal(permissionsRaw, &item.GrantedPermissions)
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

func (db *Database) SaveSpaceIntegration(ctx context.Context, userID string, item SpaceIntegration) (*SpaceIntegration, error) {
	item.Provider, item.DisplayName, item.CredentialReference = strings.TrimSpace(item.Provider), strings.TrimSpace(item.DisplayName), strings.TrimSpace(item.CredentialReference)
	if !validWorkflowToken(item.Provider, 120) || item.DisplayName == "" || len([]rune(item.DisplayName)) > 120 || item.CredentialReference == "" || len(item.CredentialReference) > 500 {
		return nil, ErrSpaceInvalid
	}
	if item.Status == "" {
		item.Status = "active"
	}
	if item.Status != "active" && item.Status != "needs_attention" && item.Status != "disabled" {
		return nil, ErrSpaceInvalid
	}
	for _, permission := range item.GrantedPermissions {
		if !validWorkflowToken(permission, 120) {
			return nil, ErrSpaceInvalid
		}
	}
	if item.ID == "" {
		item.ID = "integration_" + uuid.NewString()
	}
	permissions := mustJSON(item.GrantedPermissions)
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, item.SpaceID, PermissionStudioManage); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `INSERT INTO space_integrations(id,space_id,provider,display_name,credential_reference,granted_permissions,status,connected_by_user_id)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8)
			ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,credential_reference=EXCLUDED.credential_reference,granted_permissions=EXCLUDED.granted_permissions,status=EXCLUDED.status,updated_at=NOW()
			WHERE space_integrations.space_id=EXCLUDED.space_id
			RETURNING connected_by_user_id,created_at,updated_at`, item.ID, item.SpaceID, item.Provider, item.DisplayName, item.CredentialReference, permissions, item.Status, userID).Scan(&item.ConnectedByUserID, &item.CreatedAt, &item.UpdatedAt)
	})
	if err != nil {
		return nil, err
	}
	item.CredentialReference = ""
	return &item, nil
}

func loadWorkflowVersionTx(ctx context.Context, tx *sql.Tx, versionID string) (*WorkflowVersion, error) {
	if versionID == "" {
		return nil, ErrSpaceNotFound
	}
	out := &WorkflowVersion{}
	if err := scanWorkflowVersion(tx.QueryRowContext(ctx, `SELECT `+workflowVersionColumns+` FROM space_workflow_versions v WHERE v.id=$1`, versionID), out); err != nil {
		return nil, err
	}
	return out, nil
}

func createDefaultAgentWorkflowTx(ctx context.Context, tx *sql.Tx, userID string, item *SpaceStudioResource) error {
	workflowID := "workflow_" + uuid.NewString()
	stableIdentifier := "space." + item.SpaceID + ".agent." + item.ID
	definition := json.RawMessage(`{"nodes":[{"id":"respond","kind":"structured_prompt","config":{"prompt":"{{input}}"}}],"edges":[]}`)
	if validJSONObject(item.Definition) {
		definition = item.Definition
	}
	metadata := defaultWorkflowMetadata(item.Name, item.Description, item.RuntimeKind)
	metadataRaw, _ := json.Marshal(metadata)
	digest := sha256.Sum256(append(append([]byte{}, metadataRaw...), definition...))
	versionID := "wfver_" + uuid.NewString()
	if _, err := tx.ExecContext(ctx, `INSERT INTO space_workflows(id,space_id,creator_user_id,name,definition,enabled,stable_identifier,description,author_name,tags,suggested_agent_preset,source_kind)
		VALUES($1,$2,$3,$4,$5,TRUE,$6,$7,'Misty','["agent"]'::jsonb,$8,'custom')`, workflowID, item.SpaceID, userID, item.Name+" Workflow", definition, stableIdentifier, item.Description, mustJSON(SuggestedAgentPreset{Name: item.Name, Icon: item.Icon, Description: item.Description, Instructions: item.Instructions})); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO space_workflow_versions(id,workflow_id,space_id,stable_identifier,version,name,description,author_name,metadata,definition,checksum_sha256,created_by_user_id)
		VALUES($1,$2,$3,$4,'1.0.0',$5,$6,'Misty',$7,$8,$9,$10)`, versionID, workflowID, item.SpaceID, stableIdentifier, item.Name+" Workflow", item.Description, metadataRaw, definition, hex.EncodeToString(digest[:]), userID); err != nil {
		return err
	}
	item.ActiveWorkflowVersionID = versionID
	return nil
}

func snapshotWorkflowTx(ctx context.Context, tx *sql.Tx, userID string, item *SpaceStudioResource) (*WorkflowVersion, error) {
	var stableIdentifier, description, authorName string
	if err := tx.QueryRowContext(ctx, `SELECT stable_identifier,description,author_name FROM space_workflows WHERE id=$1 AND space_id=$2`, item.ID, item.SpaceID).Scan(&stableIdentifier, &description, &authorName); err != nil {
		return nil, err
	}
	metadata := metadataFromWorkflowDefinition(item.Name, description, item.Definition)
	if item.ActiveWorkflow != nil && ValidateWorkflowMetadata(item.ActiveWorkflow.Metadata) == nil {
		metadata = item.ActiveWorkflow.Metadata
	}
	metadataRaw, _ := json.Marshal(metadata)
	digest := sha256.Sum256(append(append([]byte{}, metadataRaw...), item.Definition...))
	checksum := hex.EncodeToString(digest[:])
	version := fmt.Sprintf("1.0.%d", maxInt64(item.Version-1, 0))
	out := &WorkflowVersion{}
	err := scanWorkflowVersion(tx.QueryRowContext(ctx, `INSERT INTO space_workflow_versions(id,workflow_id,space_id,stable_identifier,version,name,description,author_name,metadata,definition,checksum_sha256,created_by_user_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT(workflow_id,checksum_sha256) DO UPDATE SET checksum_sha256=EXCLUDED.checksum_sha256
		RETURNING `+workflowVersionReturningColumns,
		"wfver_"+uuid.NewString(), item.ID, item.SpaceID, stableIdentifier, version, item.Name, description, authorName, metadataRaw, item.Definition, checksum, userID), out)
	return out, err
}

func metadataFromWorkflowDefinition(name, description string, definition json.RawMessage) WorkflowMetadata {
	var envelope struct {
		Metadata WorkflowMetadata `json:"metadata"`
	}
	if json.Unmarshal(definition, &envelope) == nil && ValidateWorkflowMetadata(envelope.Metadata) == nil {
		return envelope.Metadata
	}
	return defaultWorkflowMetadata(name, description, "cloud")
}

func defaultWorkflowMetadata(name, description, runtimeKind string) WorkflowMetadata {
	if strings.TrimSpace(description) == "" {
		description = "Run " + name
	}
	runtime := "misty-cloud"
	if runtimeKind == "device" {
		runtime = "misty-device"
	}
	capability := WorkflowCapability{
		ID: "default", Name: name, Description: description,
		Inputs:  []WorkflowField{{Name: "prompt", Type: "string", Required: true}},
		Outputs: []WorkflowField{{Name: "result", Type: "object"}},
		Tags:    []string{"assistant"},
	}
	permissions := []string{}
	if runtimeKind == "device" {
		capability.Destructive, capability.ConfirmationRequired = true, true
		capability.Tags = []string{"files", "folders"}
		permissions = []string{"files.read", "files.write"}
	}
	return WorkflowMetadata{
		Capabilities:         []WorkflowCapability{capability},
		RequiredIntegrations: []string{}, RequiredPermissions: permissions,
		Runtime: WorkflowRuntime{Kind: runtime, Compatibility: "1"}, Tags: []string{"assistant"},
	}
}

func mustJSON(value any) json.RawMessage {
	raw, _ := json.Marshal(value)
	return raw
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func scanWorkflowVersion(scanner interface{ Scan(...any) error }, out *WorkflowVersion) error {
	var metadataRaw []byte
	if err := scanner.Scan(&out.ID, &out.WorkflowID, &out.SpaceID, &out.StableIdentifier, &out.Version, &out.Name, &out.Description, &out.AuthorName, &metadataRaw, &out.Definition, &out.ChecksumSHA256, &out.CreatedByUserID, &out.CreatedAt); err != nil {
		return err
	}
	if err := json.Unmarshal(metadataRaw, &out.Metadata); err != nil {
		return fmt.Errorf("decode workflow metadata: %w", err)
	}
	return nil
}

func validJSONObject(raw json.RawMessage) bool {
	if len(raw) == 0 || !json.Valid(raw) {
		return false
	}
	var value map[string]any
	return json.Unmarshal(raw, &value) == nil && value != nil
}
