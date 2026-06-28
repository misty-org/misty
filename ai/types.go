package ai

import (
	"encoding/json"
	"time"
)

const (
	ModeAsk  = "ask"
	ModeAuto = "auto"
	ModeFull = "full"

	EventAssistantMessage = "assistant_message"
	EventToolRequest      = "tool_request"
	EventFilePlan         = "file_plan"
	EventError            = "error"

	ToolListDirectory    = "list_directory"
	ToolSearchFiles      = "search_files"
	ToolPreviewFile      = "preview_file"
	ToolValidateFilePlan = "validate_file_plan"
	ToolApplyFilePlan    = "apply_file_plan"

	RiskRead      = "read"
	RiskWrite     = "write"
	RiskDangerous = "dangerous"
)

type AgentMessageRequest struct {
	Mode          string       `json:"mode"`
	UserMessage   string       `json:"user_message"`
	ActiveRoot    string       `json:"active_root,omitempty"`
	SelectedPaths []string     `json:"selected_paths,omitempty"`
	Capabilities  ToolManifest `json:"capabilities"`
}

type ToolManifest struct {
	Tools []ToolDefinition `json:"tools"`
}

type ToolDefinition struct {
	Name string `json:"name"`
	Risk string `json:"risk"`
}

type AgentEvent struct {
	Sequence     int64              `json:"sequence"`
	Type         string             `json:"type"`
	Text         string             `json:"text,omitempty"`
	ToolRequests []ToolRequest      `json:"tool_requests,omitempty"`
	FilePlan     *FileOperationPlan `json:"file_plan,omitempty"`
	Message      string             `json:"message,omitempty"`
	CreatedAt    time.Time          `json:"created_at"`
}

type ToolRequest struct {
	ID               string          `json:"id"`
	Name             string          `json:"name"`
	Risk             string          `json:"risk"`
	ApprovalRequired bool            `json:"approval_required"`
	Arguments        json.RawMessage `json:"arguments,omitempty"`
}

type ToolResult struct {
	RequestID string          `json:"request_id"`
	Name      string          `json:"name"`
	OK        bool            `json:"ok"`
	Result    json.RawMessage `json:"result,omitempty"`
	Error     string          `json:"error,omitempty"`
}

type FileOperationPlan struct {
	Summary    string          `json:"summary"`
	Operations []FileOperation `json:"operations"`
	Warnings   []string        `json:"warnings"`
}

type FileOperation struct {
	Type       string   `json:"type"`
	Path       string   `json:"path,omitempty"`
	From       string   `json:"from,omitempty"`
	To         string   `json:"to,omitempty"`
	Reason     string   `json:"reason,omitempty"`
	Confidence *float64 `json:"confidence,omitempty"`
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ModelRequest struct {
	SessionID    string
	UserID       string
	Mode         string
	ActiveRoot   string
	Messages     []Message
	ToolResults  []ToolResult
	Capabilities ToolManifest
	KnownPaths   []string
}

type ModelResponse struct {
	Text         string
	ToolRequests []ToolRequest
	FilePlan     *FileOperationPlan
}

type ModelProvider interface {
	Next(request ModelRequest) (ModelResponse, error)
}
