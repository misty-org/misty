package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strings"
)

type AgentCatalogEntry struct {
	AgentID      string               `json:"agent_id"`
	AgentName    string               `json:"agent_name"`
	Description  string               `json:"description"`
	Icon         string               `json:"icon"`
	Status       string               `json:"status"`
	RuntimeKind  string               `json:"runtime_kind"`
	SpaceID      string               `json:"space_id"`
	SpaceName    string               `json:"space_name"`
	Workflow     WorkflowVersion      `json:"workflow"`
	Capabilities []WorkflowCapability `json:"capabilities"`
}

type RoutingOption struct {
	SpaceID        string `json:"space_id"`
	SpaceName      string `json:"space_name"`
	AgentID        string `json:"agent_id"`
	AgentName      string `json:"agent_name"`
	CapabilityID   string `json:"capability_id"`
	CapabilityName string `json:"capability_name"`
}

type RoutingDecision struct {
	NeedsClarification bool            `json:"needs_clarification"`
	Question           string          `json:"question,omitempty"`
	Options            []RoutingOption `json:"options,omitempty"`
	Selected           *RoutingOption  `json:"selected,omitempty"`
	Reason             string          `json:"reason,omitempty"`
}

func (db *Database) DiscoverAgentCatalog(ctx context.Context, userID string) ([]AgentCatalogEntry, error) {
	items := []AgentCatalogEntry{}
	err := db.spaceTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT a.id,a.name,a.description,a.icon,a.status,a.runtime_kind,a.space_id,s.name,`+workflowVersionColumns+`
			FROM space_agents a JOIN spaces s ON s.id=a.space_id JOIN space_workflow_versions v ON v.id=a.active_workflow_version_id
			JOIN space_members m ON m.space_id=a.space_id AND m.user_id=$1
			WHERE a.enabled AND a.status='available' AND s.lifecycle_state='active' ORDER BY lower(s.name),lower(a.name)`, userID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var item AgentCatalogEntry
			var metadataRaw []byte
			if err := rows.Scan(&item.AgentID, &item.AgentName, &item.Description, &item.Icon, &item.Status, &item.RuntimeKind, &item.SpaceID, &item.SpaceName,
				&item.Workflow.ID, &item.Workflow.WorkflowID, &item.Workflow.SpaceID, &item.Workflow.StableIdentifier, &item.Workflow.Version, &item.Workflow.Name, &item.Workflow.Description, &item.Workflow.AuthorName, &metadataRaw, &item.Workflow.Definition, &item.Workflow.ChecksumSHA256, &item.Workflow.CreatedByUserID, &item.Workflow.CreatedAt); err != nil {
				return err
			}
			if err := json.Unmarshal(metadataRaw, &item.Workflow.Metadata); err != nil {
				return err
			}
			item.Capabilities = item.Workflow.Metadata.Capabilities
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		filtered := items[:0]
		for _, item := range items {
			allowed, err := hasSpacePermissionTx(ctx, tx, userID, item.SpaceID, PermissionAgentsRun)
			if err != nil {
				return err
			}
			if allowed {
				filtered = append(filtered, item)
			}
		}
		items = filtered
		return nil
	})
	return items, err
}

func (db *Database) RouteAgentRequest(ctx context.Context, userID, prompt, requestedSpaceID, requestedAgentID, requestedCapabilityID string) (*RoutingDecision, error) {
	catalog, err := db.DiscoverAgentCatalog(ctx, userID)
	if err != nil {
		return nil, err
	}
	type scored struct {
		option RoutingOption
		score  int
	}
	words := routingWords(prompt)
	candidates := []scored{}
	for _, agent := range catalog {
		if requestedSpaceID != "" && agent.SpaceID != requestedSpaceID || requestedAgentID != "" && agent.AgentID != requestedAgentID {
			continue
		}
		for _, capability := range agent.Capabilities {
			if requestedCapabilityID != "" && capability.ID != requestedCapabilityID {
				continue
			}
			score := 0
			if requestedSpaceID == agent.SpaceID {
				score += 100
			}
			if requestedAgentID == agent.AgentID {
				score += 100
			}
			if requestedCapabilityID == capability.ID {
				score += 100
			}
			if strings.Contains(strings.ToLower(prompt), strings.ToLower(agent.SpaceName)) {
				score += 30
			}
			score += routingScore(words, capability)
			candidates = append(candidates, scored{option: RoutingOption{SpaceID: agent.SpaceID, SpaceName: agent.SpaceName, AgentID: agent.AgentID, AgentName: agent.AgentName, CapabilityID: capability.ID, CapabilityName: capability.Name}, score: score})
		}
	}
	if len(candidates) == 0 {
		return &RoutingDecision{NeedsClarification: true, Question: "No available Space agent exposes that capability.", Options: []RoutingOption{}}, nil
	}
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].score > candidates[j].score })
	best := candidates[0].score
	options := []RoutingOption{candidates[0].option}
	for _, candidate := range candidates[1:] {
		if candidate.score != best {
			break
		}
		options = append(options, candidate.option)
	}
	if len(options) > 1 || best == 0 && len(candidates) > 1 {
		if best == 0 {
			options = options[:0]
			for _, candidate := range candidates {
				options = append(options, candidate.option)
			}
		}
		if len(options) > 8 {
			options = options[:8]
		}
		return &RoutingDecision{NeedsClarification: true, Question: "Which Space and agent should handle this task?", Options: options, Reason: "Multiple authorized capabilities match."}, nil
	}
	return &RoutingDecision{Selected: &candidates[0].option, Options: []RoutingOption{}, Reason: "Matched structured workflow capability metadata."}, nil
}

func routingWords(value string) map[string]bool {
	words := map[string]bool{}
	for _, field := range strings.FieldsFunc(strings.ToLower(value), func(character rune) bool {
		return !(character >= 'a' && character <= 'z' || character >= '0' && character <= '9')
	}) {
		if len(field) > 2 {
			words[field] = true
		}
	}
	return words
}

func routingScore(words map[string]bool, capability WorkflowCapability) int {
	values := []string{capability.ID, capability.Name, capability.Description}
	values = append(values, capability.Tags...)
	score := 0
	for _, value := range values {
		for word := range routingWords(value) {
			if words[word] {
				score++
			}
		}
	}
	return score
}
