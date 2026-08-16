// Package aimodels defines account-owned model routing. Credentials are resolved
// at the call boundary and must never be included in ordinary settings or runs.
package aimodels

import (
	"context"
	"errors"
	"net"
	"net/url"
	"strings"
)

var ErrDisabled = errors.New("this AI task is disabled in Models settings")

type Role struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Providers   []string `json:"providers"`
	Reasoning   bool     `json:"reasoning"`
	Optional    bool     `json:"optional"`
}

var Roles = []Role{
	{"agent", "Agent work", "Conversation, planning and tool calls.", []string{"gateway", "openai", "anthropic", "google", "openai-compatible"}, true, false},
	{"vision", "Visual interaction", "Reads screenshots and plans browser actions. Choose a model that accepts images.", []string{"gateway", "openai", "anthropic", "google", "openai-compatible"}, true, false},
	{"routing", "Task routing", "Classifies follow-ups and decides how to continue a task.", []string{"gateway", "openai"}, true, false},
	{"realtime", "Companion voice", "Live speech and companion tool calls. Choose a realtime model.", []string{"gateway", "openai"}, false, false},
	{"library", "Library analysis", "Describes files and images for search. Choose a vision model with structured output.", []string{"gateway", "openai", "openai-compatible"}, true, false},
	{"library-fallback", "Library second pass", "Optional retry and visual entity audit. Disable to limit extra requests.", []string{"gateway", "openai", "openai-compatible"}, true, true},
	{"embedding", "Search embeddings", "768-dimensional vectors. Text models use Library descriptions; visual search requires multimodal embeddings. Changing the model requires reindexing.", []string{"gateway", "openai", "openai-compatible"}, false, false},
	{"transcription", "Voice transcription", "Transcribes recorded companion audio.", []string{"gateway", "openai", "openai-compatible"}, false, false},
	{"transcription-fallback", "Transcription retry", "Optional second attempt when voice transcription fails.", []string{"gateway", "openai", "openai-compatible"}, false, true},
	{"media-transcription", "Media transcription", "Transcribes audio files for Library search.", []string{"gateway", "openai", "openai-compatible"}, false, false},
	{"media-transcription-fallback", "Media transcription retry", "Optional second attempt when media transcription fails.", []string{"gateway", "openai", "openai-compatible"}, false, true},
	{"speech", "Speech output", "Reads generated text aloud. Choose a speech model.", []string{"gateway", "openai", "openai-compatible"}, false, false},
}

type Route struct {
	Role         string `json:"role"`
	ConnectionID string `json:"connection_id"`
	Model        string `json:"model"`
	Reasoning    string `json:"reasoning"`
	Enabled      bool   `json:"enabled"`
}

// Resolved contains a secret. It is deliberately not JSON serializable.
type Resolved struct {
	Provider  string `json:"-"`
	Model     string `json:"-"`
	BaseURL   string `json:"-"`
	APIKey    string `json:"-"`
	Reasoning string `json:"-"`
}
type Resolver func(context.Context, string, string) (*Resolved, error)

func FindRole(id string) (Role, bool) {
	for _, r := range Roles {
		if r.ID == id {
			return r, true
		}
	}
	return Role{}, false
}
func Supports(role, provider string) bool {
	r, ok := FindRole(role)
	if !ok {
		return false
	}
	for _, p := range r.Providers {
		if p == provider {
			return true
		}
	}
	return false
}
func ValidModel(model string) bool {
	return len(model) > 0 && len(model) <= 200 && !strings.ContainsAny(model, " \t\r\n\x00?#") && strings.Contains(model, "/") && !strings.HasPrefix(model, "/") && !strings.HasSuffix(model, "/")
}
func ValidReasoning(value string) bool {
	switch value {
	case "", "none", "low", "medium", "high", "xhigh", "max":
		return true
	}
	return false
}
func NativeModel(provider, model string) string {
	if provider == "gateway" {
		return model
	}
	return strings.TrimPrefix(model, provider+"/")
}
func DefaultBase(provider string) string {
	switch provider {
	case "gateway":
		return "https://ai-gateway.vercel.sh/v1"
	case "openai":
		return "https://api.openai.com/v1"
	case "anthropic":
		return "https://api.anthropic.com/v1"
	case "google":
		return "https://generativelanguage.googleapis.com/v1beta"
	}
	return ""
}

func ValidateBase(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(raw) > 2048 || strings.ContainsAny(raw, "\r\n\x00") {
		return errors.New("use a public HTTPS base URL without credentials, query or fragment")
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || !strings.Contains(host, ".") {
		return errors.New("the endpoint must be reachable on the public internet")
	}
	if ip := net.ParseIP(host); ip != nil && (!ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast()) {
		return errors.New("private and reserved endpoints are not supported")
	}
	return nil
}
