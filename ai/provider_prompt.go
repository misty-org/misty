package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

type modelJSONResponse struct {
	Text         string             `json:"text"`
	ToolRequests []ToolRequest      `json:"tool_requests"`
	FilePlan     *FileOperationPlan `json:"file_plan"`
}

func buildAgentPrompt(request ModelRequest) string {
	payload := map[string]any{
		"session_id":    request.SessionID,
		"mode":          request.Mode,
		"active_root":   request.ActiveRoot,
		"messages":      request.Messages,
		"tool_results":  request.ToolResults,
		"capabilities":  request.Capabilities,
		"known_paths":   request.KnownPaths,
		"allowed_ops":   []string{"mkdir", "move", "rename"},
		"blocked_ops":   []string{"delete", "overwrite", "shell", "outside_root"},
		"response_rule": "Return one JSON object that matches the required schema. Do not include markdown.",
	}
	encoded, _ := json.MarshalIndent(payload, "", "  ")
	return fmt.Sprintf(`You are MistyAI, the private assistant inside Misty, a desktop file manager.

The Go server owns model calls, but it cannot touch local files. The desktop app owns all local filesystem access through explicit tool requests and file plans.

If you need context, request tools from the provided capabilities. Use tool_requests for reads such as list_directory, search_files, and preview_file.
If enough context is available, propose a file_plan. File plans may only use mkdir, move, and rename. Never delete, overwrite, use shell commands, use absolute paths, use path traversal, or move outside active_root.

For file organization, prefer a short inspection step first when no tool_results exist. Keep text concise and put actionable filesystem changes only in file_plan.

Current runtime state:
%s`, string(encoded))
}

func parseProviderJSONResponse(raw string) (ModelResponse, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ModelResponse{}, fmt.Errorf("model returned an empty response")
	}
	raw = trimJSONFence(raw)
	var decoded modelJSONResponse
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return ModelResponse{}, fmt.Errorf("model returned invalid agent JSON: %w", err)
	}
	response := ModelResponse{
		Text:         strings.TrimSpace(decoded.Text),
		ToolRequests: normalizeToolRequests(decoded.ToolRequests),
		FilePlan:     decoded.FilePlan,
	}
	if response.FilePlan != nil {
		response.FilePlan.Summary = strings.TrimSpace(response.FilePlan.Summary)
		if response.FilePlan.Warnings == nil {
			response.FilePlan.Warnings = []string{}
		}
	}
	return response, nil
}

func normalizeToolRequests(requests []ToolRequest) []ToolRequest {
	if len(requests) == 0 {
		return nil
	}
	normalized := make([]ToolRequest, 0, len(requests))
	for _, request := range requests {
		request.Name = strings.TrimSpace(request.Name)
		if request.Name == "" {
			continue
		}
		if request.ID == "" {
			request.ID = uuid.NewString()
		}
		request.Risk = normalizeRisk(request.Risk)
		if len(request.Arguments) == 0 {
			request.Arguments = json.RawMessage(`{}`)
		}
		normalized = append(normalized, request)
	}
	return normalized
}

func trimJSONFence(value string) string {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, "```") {
		return value
	}
	value = strings.TrimPrefix(value, "```json")
	value = strings.TrimPrefix(value, "```JSON")
	value = strings.TrimPrefix(value, "```")
	value = strings.TrimSuffix(value, "```")
	return strings.TrimSpace(value)
}

func agentResponseJSONSchema() map[string]any {
	operationSchema := map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"type":       map[string]any{"type": "string", "enum": []string{"mkdir", "move", "rename"}},
			"path":       map[string]any{"type": "string"},
			"from":       map[string]any{"type": "string"},
			"to":         map[string]any{"type": "string"},
			"reason":     map[string]any{"type": "string"},
			"confidence": map[string]any{"type": "number"},
		},
		"required": []string{"type", "path", "from", "to", "reason", "confidence"},
	}
	filePlanSchema := map[string]any{
		"type":                 []string{"object", "null"},
		"additionalProperties": false,
		"properties": map[string]any{
			"summary":    map[string]any{"type": "string"},
			"operations": map[string]any{"type": "array", "items": operationSchema},
			"warnings":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		},
		"required": []string{"summary", "operations", "warnings"},
	}
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"text": map[string]any{"type": "string"},
			"tool_requests": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"properties": map[string]any{
						"id":        map[string]any{"type": "string"},
						"name":      map[string]any{"type": "string", "enum": []string{ToolListDirectory, ToolSearchFiles, ToolPreviewFile, ToolValidateFilePlan, ToolApplyFilePlan}},
						"risk":      map[string]any{"type": "string", "enum": []string{RiskRead, RiskWrite, RiskDangerous}},
						"arguments": map[string]any{"type": "object"},
					},
					"required": []string{"id", "name", "risk", "arguments"},
				},
			},
			"file_plan": filePlanSchema,
		},
		"required": []string{"text", "tool_requests", "file_plan"},
	}
}

func geminiAgentResponseSchema() map[string]any {
	operationSchema := map[string]any{
		"type": "OBJECT",
		"properties": map[string]any{
			"type":       map[string]any{"type": "STRING", "enum": []string{"mkdir", "move", "rename"}},
			"path":       map[string]any{"type": "STRING"},
			"from":       map[string]any{"type": "STRING"},
			"to":         map[string]any{"type": "STRING"},
			"reason":     map[string]any{"type": "STRING"},
			"confidence": map[string]any{"type": "NUMBER"},
		},
	}
	return map[string]any{
		"type": "OBJECT",
		"properties": map[string]any{
			"text": map[string]any{"type": "STRING"},
			"tool_requests": map[string]any{
				"type": "ARRAY",
				"items": map[string]any{
					"type": "OBJECT",
					"properties": map[string]any{
						"id":        map[string]any{"type": "STRING"},
						"name":      map[string]any{"type": "STRING", "enum": []string{ToolListDirectory, ToolSearchFiles, ToolPreviewFile, ToolValidateFilePlan, ToolApplyFilePlan}},
						"risk":      map[string]any{"type": "STRING", "enum": []string{RiskRead, RiskWrite, RiskDangerous}},
						"arguments": map[string]any{"type": "OBJECT"},
					},
				},
			},
			"file_plan": map[string]any{
				"type":     "OBJECT",
				"nullable": true,
				"properties": map[string]any{
					"summary":    map[string]any{"type": "STRING"},
					"operations": map[string]any{"type": "ARRAY", "items": operationSchema},
					"warnings":   map[string]any{"type": "ARRAY", "items": map[string]any{"type": "STRING"}},
				},
			},
		},
	}
}
