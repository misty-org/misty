package db

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestValidateSpaceMessageLimitsAndMentions(t *testing.T) {
	if err := validateMessage([]MessageSpan{{Type: "text", Text: "hello"}, {Type: "mention", UserID: "user", Label: "Sam"}}, []string{"one"}); err != nil {
		t.Fatal(err)
	}
	if err := validateMessage([]MessageSpan{{Type: "text", Text: strings.Repeat("x", MaxMessageChars+1)}}, nil); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("oversized message error = %v", err)
	}
	if err := validateMessage([]MessageSpan{{Type: "mention", UserID: "user", AgentID: "agent"}}, nil); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("ambiguous mention error = %v", err)
	}
	if err := validateMessage([]MessageSpan{{Type: "text", Text: "hello"}}, []string{"1", "2", "3", "4", "5", "6"}); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("too many attachments error = %v", err)
	}
}

func TestValidateCloudWorkflowRejectsDeviceNodes(t *testing.T) {
	if err := validateCloudWorkflow(json.RawMessage(`{"nodes":[{"type":"http_request"},{"type":"chat_reply"}]}`)); err != nil {
		t.Fatal(err)
	}
	for _, nodeType := range []string{"select_path", "read_file", "read_text", "write_file", "copy_path", "move_path", "rename_path", "local_secret"} {
		raw := json.RawMessage(`{"nodes":[{"kind":"` + nodeType + `"}]}`)
		if err := validateCloudWorkflow(raw); !errors.Is(err, ErrSpaceInvalid) {
			t.Fatalf("node %q error = %v", nodeType, err)
		}
	}
}
