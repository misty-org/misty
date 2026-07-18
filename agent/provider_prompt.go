package agent

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"google.golang.org/genai"
)

type modelJSONResponse struct {
	Text         string             `json:"text"`
	ToolRequests []ToolRequest      `json:"tool_requests"`
	FilePlan     *FileOperationPlan `json:"file_plan"`
	Citations    []AgentCitation    `json:"citations"`
}

type agentPromptImage struct {
	Label, DataURL string
}

func buildAgentPrompt(request ModelRequest) string {
	prompt, _ := buildAgentPromptWithImages(request)
	return prompt
}

func buildAgentPromptWithImages(request ModelRequest) (string, []agentPromptImage) {
	request, images := sanitizeAgentPromptImages(request)
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
		"response_rule": "Return one JSON object that matches the required schema. Do not include markdown. When no file plan is ready, return file_plan with empty summary/completion_summary strings and empty operations/warnings arrays. Cite document-derived claims using citations and the exact source fields supplied by preview_file.",
	}
	encoded, _ := json.MarshalIndent(payload, "", "  ")
	return fmt.Sprintf(`You are MistyAI, the private assistant inside Misty, a desktop file manager.

The Go server owns model calls, but it cannot touch local files. The desktop app owns all local filesystem access through explicit tool requests and file plans.

If you need context, request tools from the provided capabilities. Use tool_requests for reads such as list_directory, search_files, and preview_file.
If enough context is available, propose a file_plan. File plans may only use mkdir, move, and rename. Never delete, overwrite, use shell commands, use absolute paths, use path traversal, or move outside active_root.
When no file plan is ready, return file_plan as an object with empty summary and completion_summary strings and empty operations and warnings arrays.

For file organization, prefer a short inspection step first when no tool_results exist. Keep text concise and put actionable filesystem changes only in file_plan. In file_plan.summary, write a user-facing future-tense summary of what will happen before Apply. In file_plan.completion_summary, write a past-tense summary that can be shown after Misty applies the plan.
For every operation, include all operation fields. Use an empty string for unused path/from/to fields. Use paths exactly as shown by list_directory/search_files tool results, relative to active_root. Keep a file_plan to 30 operations or fewer; if more work remains, add a warning.

Current runtime state:
%s`, string(encoded)), images
}

func mistyAgentInstruction() string {
	return `You are MistyAI, the private agent inside Misty, a desktop file manager.

The Go server owns model calls, but it cannot touch local files. The desktop app owns all local filesystem access through explicit tool requests and file plans.

If you need context, request tools from the provided capabilities. Use tool_requests for reads such as list_directory, search_files, and preview_file.
If enough context is available, propose a file_plan. File plans may only use mkdir, move, and rename. Never delete, overwrite, use shell commands, use absolute paths, use path traversal, or move outside active_root.

For file organization, prefer a short inspection step first when no tool_results exist. Keep text concise and put actionable filesystem changes only in file_plan. In file_plan.summary, write a user-facing future-tense summary of what will happen before Apply. In file_plan.completion_summary, write a past-tense summary that can be shown after Misty applies the plan.
For every operation, include all operation fields. Use an empty string for unused path/from/to fields. Use paths exactly as shown by list_directory/search_files tool results, relative to active_root. Keep a file_plan to 30 operations or fewer; if more work remains, add a warning.

Return only the JSON object requested by the output schema.`
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
		Citations:    normalizeAgentCitations(decoded.Citations),
	}
	if response.FilePlan != nil {
		response.FilePlan.Summary = strings.TrimSpace(response.FilePlan.Summary)
		response.FilePlan.CompletionSummary = strings.TrimSpace(response.FilePlan.CompletionSummary)
		if response.FilePlan.Warnings == nil {
			response.FilePlan.Warnings = []string{}
		}
		if len(response.FilePlan.Operations) == 0 {
			response.FilePlan = nil
		}
	}
	return response, nil
}

func agentResponseGenAISchema() *genai.Schema {
	return &genai.Schema{
		Type: genai.TypeObject,
		Properties: map[string]*genai.Schema{
			"text": {
				Type:        genai.TypeString,
				Description: "Brief assistant text to show the user.",
			},
			"tool_requests": {
				Type:        genai.TypeArray,
				Description: "Deferred Misty Desktop tool requests. Use an empty array when no tool is needed.",
				Items: &genai.Schema{
					Type: genai.TypeObject,
					Properties: map[string]*genai.Schema{
						"id": {
							Type:        genai.TypeString,
							Description: "Optional unique request id. Misty will fill one if omitted.",
						},
						"name": {
							Type: genai.TypeString,
						},
						"risk": {
							Type: genai.TypeString,
							Enum: []string{RiskRead, RiskWrite, RiskDangerous},
						},
						"arguments": {
							Type:        genai.TypeObject,
							Description: "JSON arguments for the requested tool.",
						},
					},
					Required: []string{"name", "risk", "arguments"},
				},
			},
			"file_plan": filePlanGenAISchema(true),
			"citations": agentCitationsGenAISchema(),
		},
		Required: []string{"text", "tool_requests", "file_plan", "citations"},
	}
}

func agentCitationsGenAISchema() *genai.Schema {
	return &genai.Schema{Type: genai.TypeArray, Items: &genai.Schema{Type: genai.TypeObject, Properties: map[string]*genai.Schema{
		"id": {Type: genai.TypeString}, "scopeId": {Type: genai.TypeString}, "fileName": {Type: genai.TypeString},
		"relativePath": {Type: genai.TypeString}, "kind": {Type: genai.TypeString, Enum: []string{"pdf_page", "slide", "sheet_range", "section", "image"}},
		"label": {Type: genai.TypeString}, "page": {Type: genai.TypeInteger}, "slide": {Type: genai.TypeInteger},
		"sheet": {Type: genai.TypeString}, "range": {Type: genai.TypeString}, "section": {Type: genai.TypeString}, "excerpt": {Type: genai.TypeString},
	}, Required: []string{"id", "scopeId", "fileName", "relativePath", "kind", "label", "page", "slide", "sheet", "range", "section", "excerpt"}}}
}

func filePlanGenAISchema(nullable bool) *genai.Schema {
	return &genai.Schema{
		Type:        genai.TypeObject,
		Nullable:    boolPointer(nullable),
		Description: "A safe Misty file operation plan, or null when more context is needed.",
		Properties: map[string]*genai.Schema{
			"summary": {
				Type:        genai.TypeString,
				Description: "Future-tense summary of what Misty will do before Apply.",
			},
			"completion_summary": {
				Type:        genai.TypeString,
				Description: "Past-tense summary of what Misty did after Apply.",
			},
			"operations": {
				Type:  genai.TypeArray,
				Items: fileOperationGenAISchema(),
			},
			"warnings": {
				Type:  genai.TypeArray,
				Items: &genai.Schema{Type: genai.TypeString},
			},
		},
		Required: []string{"summary", "completion_summary", "operations", "warnings"},
	}
}

func fileOperationGenAISchema() *genai.Schema {
	return &genai.Schema{
		Type:        genai.TypeObject,
		Description: "One mkdir, move, or rename operation using paths relative to active_root.",
		Properties: map[string]*genai.Schema{
			"type": {
				Type: genai.TypeString,
				Enum: []string{"mkdir", "move", "rename"},
			},
			"path": {
				Type:        genai.TypeString,
				Description: "Relative folder path for mkdir, or empty string when unused.",
			},
			"from": {
				Type:        genai.TypeString,
				Description: "Relative source path for move or rename, or empty string when unused.",
			},
			"to": {
				Type:        genai.TypeString,
				Description: "Relative destination path for move or rename, or empty string when unused.",
			},
			"reason": {
				Type:        genai.TypeString,
				Description: "Short user-facing reason.",
			},
			"confidence": {
				Type:        genai.TypeNumber,
				Description: "Confidence from 0 to 1.",
			},
		},
		Required: []string{"type", "path", "from", "to", "reason", "confidence"},
	}
}

func boolPointer(value bool) *bool {
	return &value
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
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"summary":            map[string]any{"type": "string"},
			"completion_summary": map[string]any{"type": "string"},
			"operations":         map[string]any{"type": "array", "items": operationSchema},
			"warnings":           map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		},
		"required": []string{"summary", "completion_summary", "operations", "warnings"},
	}
	citationSchema := map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
		"id": map[string]any{"type": "string"}, "scopeId": map[string]any{"type": "string"}, "fileName": map[string]any{"type": "string"},
		"relativePath": map[string]any{"type": "string"}, "kind": map[string]any{"type": "string", "enum": []string{"pdf_page", "slide", "sheet_range", "section", "image"}},
		"label": map[string]any{"type": "string"}, "page": map[string]any{"type": "integer"}, "slide": map[string]any{"type": "integer"},
		"sheet": map[string]any{"type": "string"}, "range": map[string]any{"type": "string"}, "section": map[string]any{"type": "string"}, "excerpt": map[string]any{"type": "string"},
	}, "required": []string{"id", "scopeId", "fileName", "relativePath", "kind", "label", "page", "slide", "sheet", "range", "section", "excerpt"}}
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
						"name":      map[string]any{"type": "string"},
						"risk":      map[string]any{"type": "string", "enum": []string{RiskRead, RiskWrite, RiskDangerous}},
						"arguments": map[string]any{"type": "object"},
					},
					"required": []string{"id", "name", "risk", "arguments"},
				},
			},
			"file_plan": filePlanSchema,
			"citations": map[string]any{"type": "array", "items": citationSchema},
		},
		"required": []string{"text", "tool_requests", "file_plan", "citations"},
	}
}

func sanitizeAgentPromptImages(request ModelRequest) (ModelRequest, []agentPromptImage) {
	request.ToolResults = append([]ToolResult(nil), request.ToolResults...)
	images := make([]agentPromptImage, 0, 8)
	for index := range request.ToolResults {
		if request.ToolResults[index].Name != ToolPreviewFile || len(request.ToolResults[index].Result) == 0 {
			continue
		}
		var value any
		if json.Unmarshal(request.ToolResults[index].Result, &value) != nil {
			continue
		}
		collectAndStripPromptImages(value, "document", &images)
		request.ToolResults[index].Result, _ = json.Marshal(value)
	}
	return request, images
}

func collectAndStripPromptImages(value any, context string, images *[]agentPromptImage) {
	switch typed := value.(type) {
	case map[string]any:
		if name, ok := typed["fileName"].(string); ok && strings.TrimSpace(name) != "" {
			context = name
		}
		kind, _ := typed["kind"].(string)
		locator, _ := typed["locator"].(string)
		if dataURL, ok := typed["imageDataUrl"].(string); ok && strings.HasPrefix(dataURL, "data:image/") {
			label := strings.TrimSpace(context + " " + kind + " " + locator)
			if len(*images) < 8 {
				*images = append(*images, agentPromptImage{Label: label, DataURL: dataURL})
			}
			typed["imageDataUrl"] = "[attached as multimodal image: " + label + "]"
		}
		for _, child := range typed {
			collectAndStripPromptImages(child, context, images)
		}
	case []any:
		for _, child := range typed {
			collectAndStripPromptImages(child, context, images)
		}
	}
}

func normalizeAgentCitations(values []AgentCitation) []AgentCitation {
	result := make([]AgentCitation, 0, len(values))
	for _, citation := range values {
		citation.ScopeID = strings.TrimSpace(citation.ScopeID)
		citation.FileName = strings.TrimSpace(citation.FileName)
		citation.RelativePath = strings.TrimSpace(citation.RelativePath)
		citation.Label = strings.TrimSpace(citation.Label)
		if citation.ScopeID == "" || citation.FileName == "" || citation.Label == "" || strings.HasPrefix(citation.RelativePath, "/") || strings.Contains(citation.RelativePath, "..") {
			continue
		}
		if citation.ID == "" {
			citation.ID = uuid.NewString()
		}
		if len(citation.Excerpt) > 500 {
			citation.Excerpt = citation.Excerpt[:500]
		}
		result = append(result, citation)
		if len(result) == 30 {
			break
		}
	}
	return result
}

type agentCitationSource struct {
	ScopeID      string `json:"scopeId"`
	FileName     string `json:"fileName"`
	RelativePath string `json:"relativePath"`
	Sections     []struct {
		Kind    string `json:"kind"`
		Locator string `json:"locator"`
	} `json:"sections"`
}

// groundedAgentCitations drops any model citation that is not anchored to a
// location the device explicitly supplied in a successful preview_file result.
func groundedAgentCitations(request ModelRequest, citations []AgentCitation) []AgentCitation {
	sources := make([]agentCitationSource, 0, len(request.ToolResults))
	for _, result := range request.ToolResults {
		if result.Name != ToolPreviewFile || !result.OK || len(result.Result) == 0 {
			continue
		}
		var source agentCitationSource
		if json.Unmarshal(result.Result, &source) == nil && source.ScopeID != "" && source.FileName != "" && len(source.Sections) > 0 {
			sources = append(sources, source)
		}
	}
	grounded := make([]AgentCitation, 0, len(citations))
	for _, citation := range citations {
		for _, source := range sources {
			if citation.ScopeID == source.ScopeID && citation.FileName == source.FileName && citation.RelativePath == source.RelativePath && citationMatchesSourceLocation(citation, source) {
				grounded = append(grounded, citation)
				break
			}
		}
	}
	return grounded
}

func citationMatchesSourceLocation(citation AgentCitation, source agentCitationSource) bool {
	for _, section := range source.Sections {
		kind := strings.TrimSpace(section.Kind)
		locator := strings.TrimSpace(section.Locator)
		switch citation.Kind {
		case "pdf_page":
			if kind == "page" && citation.Page > 0 && locator == strconv.Itoa(citation.Page) {
				return true
			}
		case "slide":
			if kind == "slide" && citation.Slide > 0 && locator == strconv.Itoa(citation.Slide) {
				return true
			}
		case "sheet_range":
			if kind == "sheet" && locator != "" {
				sheet, cellRange, hasRange := strings.Cut(locator, "!")
				if (hasRange && strings.TrimSpace(citation.Sheet) == strings.TrimSpace(sheet) && strings.TrimSpace(citation.Range) == strings.TrimSpace(cellRange)) || strings.Contains(citation.Label, locator) {
					return true
				}
			}
		case "section":
			if (kind == "section" || kind == "lines") && locator != "" && (locator == strings.TrimSpace(citation.Section) || strings.Contains(citation.Label, locator)) {
				return true
			}
		case "image":
			if kind == "image" {
				return true
			}
		}
	}
	return false
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
						"name":      map[string]any{"type": "STRING"},
						"risk":      map[string]any{"type": "STRING", "enum": []string{RiskRead, RiskWrite, RiskDangerous}},
						"arguments": map[string]any{"type": "OBJECT"},
					},
				},
			},
			"file_plan": map[string]any{
				"type":     "OBJECT",
				"nullable": true,
				"properties": map[string]any{
					"summary":            map[string]any{"type": "STRING"},
					"completion_summary": map[string]any{"type": "STRING"},
					"operations":         map[string]any{"type": "ARRAY", "items": operationSchema},
					"warnings":           map[string]any{"type": "ARRAY", "items": map[string]any{"type": "STRING"}},
				},
			},
		},
	}
}
