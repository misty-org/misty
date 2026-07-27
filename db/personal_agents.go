package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
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

func (db *Database) ReplacePersonalAgentGrants(ctx context.Context, userID, agentID string, inputs []PersonalAgentGrantInput) ([]PersonalAgentSpaceGrant, error) {
	if len(inputs) > 100 {
		return nil, ErrSpaceInvalid
	}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var owner string
		if err := tx.QueryRowContext(ctx, `SELECT owner_user_id FROM personal_agents WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, agentID).Scan(&owner); errors.Is(err, sql.ErrNoRows) {
			return ErrPersonalAgentNotFound
		} else if err != nil {
			return err
		}
		if owner != userID {
			return ErrSpaceForbidden
		}
		seen := map[string]bool{}
		for _, input := range inputs {
			input.SpaceID = strings.TrimSpace(input.SpaceID)
			if input.SpaceID == "" || seen[input.SpaceID] {
				return ErrSpaceInvalid
			}
			seen[input.SpaceID] = true
			if err := requireSpacePermissionTx(ctx, tx, userID, input.SpaceID, PermissionAgentsRun); err != nil {
				return err
			}
			grantID := "agentgrant_" + uuid.NewString()
			if err := tx.QueryRowContext(ctx, `INSERT INTO personal_agent_space_grants(id,agent_id,space_id,all_members,created_by_user_id) VALUES($1,$2,$3,$4,$5)
				ON CONFLICT(agent_id,space_id) DO UPDATE SET all_members=EXCLUDED.all_members,updated_at=NOW() RETURNING id`, grantID, agentID, input.SpaceID, input.AllMembers, userID).Scan(&grantID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM personal_agent_member_grants WHERE grant_id=$1`, grantID); err != nil {
				return err
			}
			if input.AllMembers {
				continue
			}
			memberSeen := map[string]bool{}
			for _, memberID := range input.MemberUserIDs {
				memberID = strings.TrimSpace(memberID)
				if memberID == "" || memberSeen[memberID] {
					continue
				}
				memberSeen[memberID] = true
				var member bool
				if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2)`, input.SpaceID, memberID).Scan(&member); err != nil {
					return err
				}
				if !member {
					return ErrSpaceInvalid
				}
				if _, err := tx.ExecContext(ctx, `INSERT INTO personal_agent_member_grants(grant_id,user_id) VALUES($1,$2)`, grantID, memberID); err != nil {
					return err
				}
			}
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM personal_agent_space_grants WHERE agent_id=$1 AND NOT (space_id = ANY($2::text[]))`, agentID, pqStringArray(mapKeys(seen)))
		return err
	})
	if err != nil {
		return nil, err
	}
	return db.PersonalAgentGrants(ctx, userID, agentID)
}

func mapKeys(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	return out
}

func personalAgentAllowedTx(ctx context.Context, tx *sql.Tx, userID, spaceID, agentID string) (*PersonalAgent, error) {
	if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead); err != nil {
		return nil, err
	}
	if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionAgentsRun); err != nil {
		return nil, err
	}
	out := &PersonalAgent{}
	err := scanPersonalAgent(tx.QueryRowContext(ctx, `SELECT `+personalAgentColumns+` FROM personal_agents a WHERE a.id=$1 AND a.enabled AND a.deleted_at IS NULL AND (
		a.owner_user_id=$2 OR EXISTS(SELECT 1 FROM personal_agent_space_grants g WHERE g.agent_id=a.id AND g.space_id=$3 AND (g.all_members OR EXISTS(SELECT 1 FROM personal_agent_member_grants mg WHERE mg.grant_id=g.id AND mg.user_id=$2))))`, agentID, userID, spaceID), out)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrPersonalAgentNotFound
	}
	return out, err
}

func (db *Database) PersonalAgentForSpace(ctx context.Context, userID, spaceID, agentID string) (*PersonalAgent, error) {
	var out *PersonalAgent
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		var err error
		out, err = personalAgentAllowedTx(ctx, tx, userID, spaceID, agentID)
		return err
	})
	return out, err
}

func (db *Database) AccessiblePersonalAgents(ctx context.Context, userID, spaceID string) ([]PersonalAgent, error) {
	items := []PersonalAgent{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead); err != nil {
			return err
		}
		if err := requireSpacePermissionTx(ctx, tx, userID, spaceID, PermissionAgentsRun); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT `+personalAgentColumns+` FROM personal_agents a WHERE a.enabled AND a.deleted_at IS NULL AND (a.owner_user_id=$1 OR EXISTS(
			SELECT 1 FROM personal_agent_space_grants g WHERE g.agent_id=a.id AND g.space_id=$2 AND (g.all_members OR EXISTS(SELECT 1 FROM personal_agent_member_grants mg WHERE mg.grant_id=g.id AND mg.user_id=$1)))) ORDER BY lower(a.name),a.id`, userID, spaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item PersonalAgent
			if err := scanPersonalAgent(rows, &item); err != nil {
				return err
			}
			if item.OwnerUserID != userID {
				item.Instructions = ""
				item.ContextPermissions = nil
				item.ToolPermissions = nil
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	return items, err
}

// PersonalAgentSpaceContext returns a bounded, permission-checked textual snapshot.
// It deliberately retrieves only shared Space material; private agent memory is kept
// in the invoker-scoped instance and is never mixed across members.
func (db *Database) PersonalAgentSpaceContext(ctx context.Context, userID, spaceID string, permissions json.RawMessage) (string, error) {
	return db.PersonalAgentSpaceContextForConversation(ctx, userID, spaceID, "", permissions)
}

// PersonalAgentSpaceContextForConversation builds the same bounded Space
// context while limiting chat history to the current shared conversation.
// An empty conversation ID means the Space-wide chat, never every private
// selected-member conversation in the Space.
func (db *Database) PersonalAgentSpaceContextForConversation(ctx context.Context, userID, spaceID, conversationID string, permissions json.RawMessage) (string, error) {
	var allowed map[string]bool
	_ = json.Unmarshal(permissions, &allowed)
	// "notes" here has always meant the free-text notes column on a task, not
	// the Notes surface, which is device-local and unreadable by the server. The
	// key is now "task_notes"; the old name is still honoured because this value
	// is a stored user setting in personal_agents.context_permissions and a hard
	// break would silently flip someone's toggle.
	if allowed["notes"] && !allowed["task_notes"] {
		allowed["task_notes"] = true
	}
	parts := []string{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		// Membership is the entry gate, not messages.read. This used to require
		// messages.read for the whole function, so a member with Library and
		// Tasks access but no chat access received zero Space context -- not even
		// the Library and Tasks they can see. Each section below still checks its
		// own permission, and the "may this member use agents here" gate is
		// agents.run, enforced upstream by validateAgentSpaceAccessTx.
		if _, err := requireSpaceMemberTx(ctx, tx, spaceID, userID); err != nil {
			return err
		}
		var name string
		if err := tx.QueryRowContext(ctx, `SELECT name FROM spaces WHERE id=$1`, spaceID).Scan(&name); err != nil {
			return err
		}
		parts = append(parts, "Space: "+name)
		if allowed["members"] {
			rows, err := tx.QueryContext(ctx, `SELECT u.name FROM space_members m JOIN users u ON u.id=m.user_id WHERE m.space_id=$1 ORDER BY lower(u.name) LIMIT 50`, spaceID)
			if err != nil {
				return err
			}
			names := []string{}
			for rows.Next() {
				var value string
				if err := rows.Scan(&value); err != nil {
					rows.Close()
					return err
				}
				names = append(names, value)
			}
			if err := rows.Close(); err != nil {
				return err
			}
			if len(names) > 0 {
				parts = append(parts, "Members: "+strings.Join(names, ", "))
			}
		}
		// messages.read is checked here rather than as the entry gate, so a member
		// without chat access loses only this section instead of the whole context.
		canReadChat := false
		if allowed["space_chat"] {
			readable, permissionErr := hasSpacePermissionTx(ctx, tx, userID, spaceID, PermissionMessagesRead)
			if permissionErr != nil {
				return permissionErr
			}
			canReadChat = readable
		}
		if canReadChat {
			if conversationID != "" {
				if err := requireSpaceConversationMemberTx(ctx, tx, userID, spaceID, conversationID); err != nil {
					return err
				}
			}
			rows, err := tx.QueryContext(ctx, `SELECT content FROM space_messages WHERE space_id=$1 AND COALESCE(conversation_id,'')=$2 ORDER BY seq DESC LIMIT 30`, spaceID, conversationID)
			if err != nil {
				return err
			}
			messages := []string{}
			for rows.Next() {
				var raw []byte
				if err := rows.Scan(&raw); err != nil {
					rows.Close()
					return err
				}
				var spans []MessageSpan
				_ = json.Unmarshal(raw, &spans)
				if value := messagePreview(spans); value != "" {
					messages = append(messages, value)
				}
			}
			if err := rows.Close(); err != nil {
				return err
			}
			for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
				messages[left], messages[right] = messages[right], messages[left]
			}
			if len(messages) > 0 {
				parts = append(parts, "Recent chat:\n- "+strings.Join(messages, "\n- "))
			}
		}
		if allowed["tasks"] || allowed["task_notes"] {
			canViewTasks, permissionErr := hasSpacePermissionTx(ctx, tx, userID, spaceID, PermissionTasksView)
			if permissionErr != nil {
				return permissionErr
			}
			if canViewTasks && allowed["tasks"] {
				rows, queryErr := tx.QueryContext(ctx, `SELECT title,status FROM space_tasks WHERE space_id=$1 AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 30`, spaceID)
				if queryErr != nil {
					return queryErr
				}
				tasks := []string{}
				for rows.Next() {
					var title, status string
					if err := rows.Scan(&title, &status); err != nil {
						rows.Close()
						return err
					}
					tasks = append(tasks, fmt.Sprintf("%s (%s)", title, status))
				}
				if err := rows.Close(); err != nil {
					return err
				}
				if len(tasks) > 0 {
					parts = append(parts, "Tasks:\n- "+strings.Join(tasks, "\n- "))
				}
			}
			if canViewTasks && allowed["task_notes"] {
				rows, queryErr := tx.QueryContext(ctx, `SELECT title,notes FROM space_tasks WHERE space_id=$1 AND archived_at IS NULL AND btrim(notes)<>'' ORDER BY updated_at DESC LIMIT 20`, spaceID)
				if queryErr != nil {
					return queryErr
				}
				notes := []string{}
				for rows.Next() {
					var title, note string
					if err := rows.Scan(&title, &note); err != nil {
						rows.Close()
						return err
					}
					notes = append(notes, strings.TrimSpace(title+": "+note))
				}
				if err := rows.Close(); err != nil {
					return err
				}
				if len(notes) > 0 {
					parts = append(parts, "Task notes:\n- "+strings.Join(notes, "\n- "))
				}
			}
		}
		if allowed["library"] {
			ok, permissionErr := hasSpacePermissionTx(ctx, tx, userID, spaceID, PermissionLibraryView)
			if permissionErr != nil {
				return permissionErr
			}
			if ok {
				rows, queryErr := tx.QueryContext(ctx, `SELECT display_name,caption,tags FROM space_library_items WHERE space_id=$1 AND lifecycle_state='ready' AND hidden=FALSE ORDER BY updated_at DESC LIMIT 40`, spaceID)
				if queryErr == nil {
					items := []string{}
					for rows.Next() {
						var display, caption string
						var tagsRaw []byte
						if rows.Scan(&display, &caption, &tagsRaw) == nil {
							var tags []string
							_ = json.Unmarshal(tagsRaw, &tags)
							items = append(items, strings.TrimSpace(strings.Join([]string{display, caption, strings.Join(tags, ", ")}, " — ")))
						}
					}
					_ = rows.Close()
					if len(items) > 0 {
						parts = append(parts, "Library:\n- "+strings.Join(items, "\n- "))
					}
				}
			}
		}
		return nil
	})
	return strings.Join(parts, "\n\n"), err
}

func (db *Database) AppendPersonalAgentMemory(ctx context.Context, userID, spaceID, agentID, prompt, response string) error {
	prompt, response = strings.TrimSpace(prompt), strings.TrimSpace(response)
	if prompt == "" || response == "" {
		return nil
	}
	event, _ := json.Marshal(map[string]any{"prompt": prompt, "response": response, "created_at": time.Now().UTC()})
	return db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := personalAgentAllowedTx(ctx, tx, userID, spaceID, agentID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO personal_agent_instances(id,agent_id,invoker_user_id,space_id,scope_key,memory)
			VALUES($1,$2,$3,$4,$4,jsonb_build_array($5::jsonb))
			ON CONFLICT(agent_id,invoker_user_id,scope_key) DO UPDATE SET memory=(CASE WHEN jsonb_array_length(personal_agent_instances.memory)>=20 THEN personal_agent_instances.memory-(0) ELSE personal_agent_instances.memory END)||$5::jsonb,updated_at=NOW()`,
			"agentinstance_"+uuid.NewString(), agentID, userID, spaceID, event)
		return err
	})
}

// PersonalAgentMemoryContext returns only the memory isolated to one invoker,
// agent, and Space. Authorization is checked on every read so revoking a grant
// or removing a member immediately prevents future use of that memory.
func (db *Database) PersonalAgentMemoryContext(ctx context.Context, userID, spaceID, agentID string) (string, error) {
	type memoryEvent struct {
		Prompt   string    `json:"prompt"`
		Response string    `json:"response"`
		Created  time.Time `json:"created_at"`
	}
	events := []memoryEvent{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		if _, err := personalAgentAllowedTx(ctx, tx, userID, spaceID, agentID); err != nil {
			return err
		}
		var raw []byte
		err := tx.QueryRowContext(ctx, `SELECT memory FROM personal_agent_instances
			WHERE agent_id=$1 AND invoker_user_id=$2 AND scope_key=$3`, agentID, userID, spaceID).Scan(&raw)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		return json.Unmarshal(raw, &events)
	})
	if err != nil {
		return "", err
	}
	parts := make([]string, 0, len(events))
	for _, event := range events {
		prompt, response := strings.TrimSpace(event.Prompt), strings.TrimSpace(event.Response)
		if prompt != "" && response != "" {
			parts = append(parts, "User: "+prompt+"\nAgent: "+response)
		}
	}
	return strings.Join(parts, "\n\n"), nil
}
