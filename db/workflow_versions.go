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
	workflowv2 "github.com/kannachi323/misty/server/workflow"
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
			if !workflowChecksumValid(&item) {
				return ErrSpaceInvalid
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
		if err := scanWorkflowVersion(tx.QueryRowContext(ctx, `SELECT `+workflowVersionColumns+` FROM space_workflow_versions v WHERE v.id=$1 AND v.space_id=$2`, versionID, spaceID), out); err != nil {
			return err
		}
		if !workflowChecksumValid(out) {
			return ErrSpaceInvalid
		}
		return nil
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
	var definitionValue any
	if json.Unmarshal(definition, &definitionValue) != nil {
		return nil, ErrSpaceInvalid
	}
	canonicalDefinition, _ := json.Marshal(definitionValue)
	digest := sha256.Sum256(append(append([]byte{}, metadataRaw...), canonicalDefinition...))
	checksum := hex.EncodeToString(digest[:])
	out := &WorkflowVersion{ID: "wfver_" + uuid.NewString(), SpaceID: spaceID, WorkflowID: workflowID, Version: version, Metadata: metadata, Definition: canonicalDefinition, ChecksumSHA256: checksum, CreatedByUserID: userID}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionStudioManage); err != nil {
			return err
		}
		if err := validateWorkflowV2Tx(ctx, tx, spaceID, canonicalDefinition); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx, `SELECT stable_identifier,name,description,author_name FROM space_workflows WHERE id=$1 AND space_id=$2 AND creator_user_id=$3`, workflowID, spaceID, userID).Scan(&out.StableIdentifier, &out.Name, &out.Description, &out.AuthorName); err != nil {
			return err
		}
		err := scanWorkflowVersion(tx.QueryRowContext(ctx, `INSERT INTO space_workflow_versions(id,workflow_id,space_id,stable_identifier,version,name,description,author_name,metadata,definition,checksum_sha256,created_by_user_id)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING `+workflowVersionReturningColumns,
			out.ID, workflowID, spaceID, out.StableIdentifier, version, out.Name, out.Description, out.AuthorName, metadataRaw, canonicalDefinition, checksum, userID), out)
		if err == nil {
			_, err = tx.ExecContext(ctx, `UPDATE space_workflows SET definition=$1,version=version+1,updated_at=NOW() WHERE id=$2`, canonicalDefinition, workflowID)
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
		rows, err := tx.QueryContext(ctx, `SELECT id,space_id,provider,display_name,'',granted_permissions,status,connected_by_user_id,created_at,updated_at FROM space_integrations WHERE space_id=$1 AND connected_by_user_id=$2 ORDER BY provider,display_name`, spaceID, userID)
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
	if item.GrantedPermissions == nil {
		item.GrantedPermissions = []string{}
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
		if err := requireSpacePermissionTx(ctx, tx, userID, item.SpaceID, PermissionAgentsRun); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `INSERT INTO space_integrations(id,space_id,provider,display_name,credential_reference,granted_permissions,status,connected_by_user_id)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8)
			ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,credential_reference=EXCLUDED.credential_reference,granted_permissions=EXCLUDED.granted_permissions,status=EXCLUDED.status,updated_at=NOW()
			WHERE space_integrations.space_id=EXCLUDED.space_id AND space_integrations.connected_by_user_id=EXCLUDED.connected_by_user_id
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
	if !workflowChecksumValid(out) {
		return nil, ErrSpaceInvalid
	}
	return out, nil
}

func workflowChecksumValid(version *WorkflowVersion) bool {
	if version == nil {
		return false
	}
	metadataRaw, err := json.Marshal(version.Metadata)
	if err != nil {
		return false
	}
	var definition any
	if json.Unmarshal(version.Definition, &definition) != nil {
		return false
	}
	definitionRaw, err := json.Marshal(definition)
	if err != nil {
		return false
	}
	digest := sha256.Sum256(append(append([]byte{}, metadataRaw...), definitionRaw...))
	return hex.EncodeToString(digest[:]) == version.ChecksumSHA256
}

func loadLatestWorkflowVersionTx(ctx context.Context, tx *sql.Tx, workflowID string) (*WorkflowVersion, error) {
	var versionID string
	if err := tx.QueryRowContext(ctx, `SELECT id FROM space_workflow_versions WHERE workflow_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, workflowID).Scan(&versionID); err != nil {
		return nil, err
	}
	return loadWorkflowVersionTx(ctx, tx, versionID)
}

func createDefaultAgentWorkflowTx(ctx context.Context, tx *sql.Tx, userID string, item *SpaceStudioResource) error {
	workflowID := "workflow_" + uuid.NewString()
	stableIdentifier := "space." + item.SpaceID + ".agent." + item.ID
	definition := json.RawMessage(`{"nodes":[{"id":"respond","kind":"structured_prompt","config":{"prompt":"{{input}}"}}],"edges":[]}`)
	if workflowDefinitionHasNodes(item.Definition) {
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

func workflowDefinitionHasNodes(definition json.RawMessage) bool {
	var parsed struct {
		Nodes []json.RawMessage `json:"nodes"`
	}
	return json.Unmarshal(definition, &parsed) == nil && len(parsed.Nodes) > 0
}

func snapshotWorkflowTx(ctx context.Context, tx *sql.Tx, userID string, item *SpaceStudioResource) (*WorkflowVersion, error) {
	var stableIdentifier, description, authorName string
	if err := tx.QueryRowContext(ctx, `SELECT stable_identifier,description,author_name FROM space_workflows WHERE id=$1 AND space_id=$2`, item.ID, item.SpaceID).Scan(&stableIdentifier, &description, &authorName); err != nil {
		return nil, err
	}
	metadata, explicitMetadata, err := metadataFromWorkflowDefinition(item.Name, description, item.Definition)
	if err != nil {
		return nil, err
	}
	if !explicitMetadata && item.ActiveWorkflow != nil && ValidateWorkflowMetadata(item.ActiveWorkflow.Metadata) == nil {
		metadata = item.ActiveWorkflow.Metadata
	}
	metadataRaw, _ := json.Marshal(metadata)
	digest := sha256.Sum256(append(append([]byte{}, metadataRaw...), item.Definition...))
	checksum := hex.EncodeToString(digest[:])
	version := fmt.Sprintf("1.0.%d", maxInt64(item.Version-1, 0))
	out := &WorkflowVersion{}
	err = scanWorkflowVersion(tx.QueryRowContext(ctx, `INSERT INTO space_workflow_versions(id,workflow_id,space_id,stable_identifier,version,name,description,author_name,metadata,definition,checksum_sha256,created_by_user_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT(workflow_id,checksum_sha256) DO UPDATE SET checksum_sha256=EXCLUDED.checksum_sha256
		RETURNING `+workflowVersionReturningColumns,
		"wfver_"+uuid.NewString(), item.ID, item.SpaceID, stableIdentifier, version, item.Name, description, authorName, metadataRaw, item.Definition, checksum, userID), out)
	return out, err
}

func metadataFromWorkflowDefinition(name, description string, definition json.RawMessage) (WorkflowMetadata, bool, error) {
	var envelope map[string]json.RawMessage
	if json.Unmarshal(definition, &envelope) != nil || envelope == nil {
		return WorkflowMetadata{}, false, ErrSpaceInvalid
	}
	raw, exists := envelope["metadata"]
	if !exists {
		return defaultWorkflowMetadata(name, description, "cloud"), false, nil
	}
	var metadata WorkflowMetadata
	if json.Unmarshal(raw, &metadata) != nil || ValidateWorkflowMetadata(metadata) != nil {
		return WorkflowMetadata{}, true, ErrSpaceInvalid
	}
	return metadata, true, nil
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

func validateCapabilityInput(capability WorkflowCapability, raw json.RawMessage) error {
	var input map[string]any
	if json.Unmarshal(raw, &input) != nil || input == nil {
		return ErrSpaceInvalid
	}
	for _, field := range capability.Inputs {
		value, exists := input[field.Name]
		if !exists || value == nil {
			if field.Required {
				return ErrSpaceInvalid
			}
			continue
		}
		if !workflowValueMatchesType(value, field.Type) {
			return ErrSpaceInvalid
		}
		if field.Required && strings.EqualFold(strings.TrimSpace(field.Type), "string") && strings.TrimSpace(value.(string)) == "" {
			return ErrSpaceInvalid
		}
	}
	return nil
}

func validateWorkflowVersionDefinition(metadata WorkflowMetadata, definition json.RawMessage) error {
	var parsed workflowv2.Definition
	if json.Unmarshal(definition, &parsed) != nil || len(parsed.Dependencies) > 0 {
		return ErrSpaceInvalid
	}
	if err := workflowv2.Validate(parsed, workflowv2.CoreRegistry(), nil); err != nil {
		return ErrSpaceInvalid
	}
	return nil
}

type workflowDependencyRecord struct {
	workflowID string
	checksum   string
	definition workflowv2.Definition
}

type workflowDependencyResolver map[string]workflowDependencyRecord

func (resolver workflowDependencyResolver) ResolveWorkflowVersion(versionID string) (string, string, workflowv2.Definition, bool) {
	item, ok := resolver[versionID]
	return item.workflowID, item.checksum, item.definition, ok
}

func validateWorkflowV2Tx(ctx context.Context, tx *sql.Tx, spaceID string, raw json.RawMessage) error {
	var root workflowv2.Definition
	if json.Unmarshal(raw, &root) != nil {
		return ErrSpaceInvalid
	}
	resolver := workflowDependencyResolver{}
	var load func(workflowv2.Definition) error
	load = func(definition workflowv2.Definition) error {
		for _, dependency := range definition.Dependencies {
			if _, loaded := resolver[dependency.VersionID]; loaded {
				continue
			}
			var workflowID, checksum string
			var childRaw []byte
			if err := tx.QueryRowContext(ctx, `SELECT workflow_id,checksum_sha256,definition FROM space_workflow_versions WHERE id=$1 AND space_id=$2`, dependency.VersionID, spaceID).Scan(&workflowID, &checksum, &childRaw); err != nil {
				return ErrSpaceInvalid
			}
			var child workflowv2.Definition
			if json.Unmarshal(childRaw, &child) != nil {
				return ErrSpaceInvalid
			}
			resolver[dependency.VersionID] = workflowDependencyRecord{workflowID: workflowID, checksum: checksum, definition: child}
			if err := load(child); err != nil {
				return err
			}
		}
		return nil
	}
	if err := load(root); err != nil {
		return err
	}
	if err := workflowv2.Validate(root, workflowv2.CoreRegistry(), resolver); err != nil {
		return ErrSpaceInvalid
	}
	return nil
}

func workflowValueMatchesType(value any, declaredType string) bool {
	switch strings.ToLower(strings.TrimSpace(declaredType)) {
	case "any", "json":
		return true
	case "string", "text":
		_, ok := value.(string)
		return ok
	case "boolean", "bool":
		_, ok := value.(bool)
		return ok
	case "number", "float", "double":
		_, ok := value.(float64)
		return ok
	case "integer", "int":
		number, ok := value.(float64)
		return ok && number == float64(int64(number))
	case "object", "map":
		_, ok := value.(map[string]any)
		return ok
	case "array", "list":
		_, ok := value.([]any)
		return ok
	case "null":
		return value == nil
	default:
		// Portable packages may define richer domain types. Their field-level
		// schema remains authoritative to the compatible workflow runtime.
		return true
	}
}
