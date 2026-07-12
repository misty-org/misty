package agent

import (
	"context"
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

const MaxModelOutputTokens int64 = 2200

const (
	MaxUserMessageBytes      = 32 << 10
	MaxToolResultsPerRequest = 8
	MaxToolResultBytes       = 512 << 10
	MaxProviderRequestBytes  = 768 << 10
	MaxProviderCallsPerTurn  = 3
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
	Sequence         int64              `json:"sequence"`
	Type             string             `json:"type"`
	Text             string             `json:"text,omitempty"`
	ToolRequests     []ToolRequest      `json:"tool_requests,omitempty"`
	FilePlan         *FileOperationPlan `json:"file_plan,omitempty"`
	Message          string             `json:"message,omitempty"`
	CreatedAt        time.Time          `json:"created_at"`
	CreditsUsed      int64              `json:"credits_used,omitempty"`
	CreditsRemaining int64              `json:"credits_remaining,omitempty"`
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
	Summary           string          `json:"summary"`
	CompletionSummary string          `json:"completion_summary"`
	Operations        []FileOperation `json:"operations"`
	Warnings          []string        `json:"warnings"`
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
	MikaTier     MikaTier
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
	Usage        ModelUsage
}

type ModelUsage struct {
	InputTokens       int64 `json:"input_tokens"`
	CachedInputTokens int64 `json:"cached_input_tokens"`
	OutputTokens      int64 `json:"output_tokens"`
	ReasoningTokens   int64 `json:"reasoning_tokens"`
	Estimated         bool  `json:"estimated"`
}

type UsageReservation struct {
	ID              string
	ReservedCredits int64
}

type UsageSettlement struct {
	CreditsUsed      int64
	CreditsRemaining int64
}

type UsageMeter interface {
	Reserve(userID, idempotencyKey, meter, provider, model string, estimatedInputTokens, maxOutputTokens int64) (*UsageReservation, error)
	Settle(reservation *UsageReservation, idempotencyKey, meter, provider, model string, usage ModelUsage) (UsageSettlement, error)
	Release(reservation *UsageReservation) error
}

type CreditsExhaustedError struct {
	Required  int64
	Available int64
	ResetAt   time.Time
}

func (e CreditsExhaustedError) Error() string { return "managed AI credits exhausted" }

type ModelProvider interface {
	Next(request ModelRequest) (ModelResponse, error)
}

// ContextModelProvider is implemented by production providers so an in-flight
// request can be canceled. ModelProvider remains for local/test compatibility.
type ContextModelProvider interface {
	NextContext(ctx context.Context, request ModelRequest) (ModelResponse, error)
}

type ProviderInfo interface {
	ProviderName() string
	ModelName() string
}
