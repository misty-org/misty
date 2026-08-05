package api

import (
	"context"
	"strings"

	serveragent "github.com/kannachi323/misty/server/internal/agents"
)

const maxAgentConversationContextChars = 8_000

func recentAgentConversationContext(ctx context.Context, runtime *serveragent.Service, sessionID, userID string) (string, error) {
	messages, err := runtime.Transcript(ctx, sessionID, userID)
	if err != nil {
		return "", err
	}
	return renderRecentAgentConversation(messages), nil
}

func renderRecentAgentConversation(messages []serveragent.Message) string {
	parts := make([]string, 0, len(messages))
	characters := 0
	for index := len(messages) - 1; index >= 0; index-- {
		content := strings.TrimSpace(messages[index].Content)
		if content == "" {
			continue
		}
		role := "Member"
		if messages[index].Role == serveragent.RoleAgent || messages[index].Role == serveragent.RoleAgentLegacy {
			role = "Agent"
		}
		line := role + ": " + content
		if characters+len([]rune(line)) > maxAgentConversationContextChars {
			break
		}
		parts = append(parts, line)
		characters += len([]rune(line))
	}
	for left, right := 0, len(parts)-1; left < right; left, right = left+1, right-1 {
		parts[left], parts[right] = parts[right], parts[left]
	}
	return strings.Join(parts, "\n")
}

func TestingRenderRecentAgentConversation(messages []serveragent.Message) string {
	return renderRecentAgentConversation(messages)
}
