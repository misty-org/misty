package db

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"

	api "github.com/kannachi323/misty/server/internal/platform/httpapi"
	. "github.com/kannachi323/misty/server/internal/platform/postgres"
	workflowv2 "github.com/kannachi323/misty/server/internal/workflows"
)

func TestPrivateSpaceConversationCreatesTaskThroughServerOwnedTool(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Space Chat Owner", "space-chat-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	space, err := database.CreateSpace(ctx, owner.ID, "Agentic Space")
	if err != nil {
		t.Fatal(err)
	}

	result, err := api.TestingExecuteSpaceConversationTaskTool(
		ctx,
		database,
		owner.ID,
		space.ID,
		"",
		"Create a task called Review beta readiness",
		"tasks.create",
		json.RawMessage(`{"title":"Review beta readiness","priority":"high"}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	var created SpaceTask
	if err := json.Unmarshal(result, &created); err != nil {
		t.Fatal(err)
	}
	if created.Title != "Review beta readiness" || created.Priority != "high" || created.CreatedByUserID != owner.ID {
		t.Fatalf("created Task = %#v", created)
	}
	page, err := database.SpaceTaskPage(ctx, owner.ID, space.ID, SpaceTaskQuery{Search: "beta readiness", Limit: 10})
	if err != nil || len(page.Tasks) != 1 || page.Tasks[0].ID != created.ID {
		t.Fatalf("persisted Tasks = %#v, %v", page.Tasks, err)
	}
}

func TestPrivateSpaceConversationTaskWriteRechecksMemberPermission(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Space Tool Owner", "space-tool-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	member, err := database.CreateUser("Space Tool Viewer", "space-tool-viewer@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	space, err := database.CreateSpace(ctx, owner.ID, "Permission Space")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := database.InviteToSpace(ctx, owner.ID, space.ID, member.Email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.RespondToSpaceInvite(ctx, member.ID, invite.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := database.SetSpaceMemberPermission(ctx, owner.ID, space.ID, member.ID, PermissionTasksManage, "deny"); err != nil {
		t.Fatal(err)
	}

	_, err = api.TestingExecuteSpaceConversationTaskTool(
		ctx,
		database,
		member.ID,
		space.ID,
		"",
		"Create a task called Forbidden task",
		"tasks.create",
		json.RawMessage(`{"title":"Forbidden task"}`),
	)
	if !errors.Is(err, workflowv2.ErrCapabilityDenied) {
		t.Fatalf("task write error = %v, want capability denied", err)
	}
}

func TestPrivateSpaceAgentSendsExactMessageThroughServerOwnedToolbox(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Space Message Owner", "space-message-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	space, err := database.CreateSpace(ctx, owner.ID, "Message Space")
	if err != nil {
		t.Fatal(err)
	}
	personal, err := database.CreatePersonalAgent(ctx, owner.ID, PersonalAgent{
		Name: "Messenger", ModelMode: "pinned", ModelID: "google/gemini-2.5-flash-lite",
		ToolPermissions: json.RawMessage(`{"read":true,"write":true,"grants":[{"capability":"messages.send","risk":"write"}]}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.AddSpaceAgentMembership(
		ctx, owner.ID, space.ID, SpaceAgentMembershipInput{AgentID: personal.ID},
	); err != nil {
		t.Fatal(err)
	}

	result, err := api.TestingExecuteSpaceConversationTool(
		ctx, database, owner.ID, space.ID, personal.ID,
		"Tell everyone Stone is off for today", "messages.send",
		json.RawMessage(`{"message":"Stone is off for today"}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	var sent struct {
		MessageID string `json:"message_id"`
	}
	if json.Unmarshal(result, &sent) != nil || sent.MessageID == "" {
		t.Fatalf("send result = %s", result)
	}
	messages, err := database.SpaceMessages(ctx, owner.ID, space.ID, 0, 10)
	if err != nil || len(messages) != 1 {
		t.Fatalf("shared Agent messages = %#v, %v", messages, err)
	}
	rawContent, _ := json.Marshal(messages[0].Content)
	if messages[0].SenderAgentID != personal.ID ||
		!strings.Contains(string(rawContent), "Stone is off for today") {
		t.Fatalf("shared Agent messages = %#v, %v", messages, err)
	}
}

func TestGlobalPersonalAgentCreatesTaskOnlyInTheNamedGrantedSpace(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Global Agent Owner", "global-agent-task-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	design, err := database.CreateSpace(ctx, owner.ID, "Design Space")
	if err != nil {
		t.Fatal(err)
	}
	finance, err := database.CreateSpace(ctx, owner.ID, "Finance Space")
	if err != nil {
		t.Fatal(err)
	}
	personal, err := database.CreatePersonalAgent(ctx, owner.ID, PersonalAgent{
		Name: "Operator", ModelMode: "pinned", ModelID: "google/gemini-2.5-flash-lite",
		ToolPermissions: json.RawMessage(`{"read":true,"write":true,"grants":[{"capability":"spaces.list_accessible","risk":"read"},{"capability":"tasks.query","risk":"read"},{"capability":"tasks.create","risk":"write"}]}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.ReplacePersonalAgentGrants(ctx, owner.ID, personal.ID, []PersonalAgentGrantInput{
		{SpaceID: design.ID, AllMembers: true}, {SpaceID: finance.ID, AllMembers: true},
	}); err != nil {
		t.Fatal(err)
	}
	inspected, err := api.TestingExecuteGlobalAgentTool(ctx, database, owner.ID, personal.ID,
		"Who is in Design Space?", "spaces.list_accessible", json.RawMessage(`{"space_id":`+strconv.Quote(design.ID)+`}`))
	if err != nil || !strings.Contains(string(inspected), "Members:") || !strings.Contains(string(inspected), "Global Agent Owner") {
		t.Fatalf("global Agent Space inspection = %s, %v", inspected, err)
	}

	result, err := api.TestingExecuteGlobalAgentTaskTool(ctx, database, owner.ID, personal.ID,
		"Create a task called Review beta in Design Space", "tasks.create",
		json.RawMessage(`{"space_id":`+strconv.Quote(design.ID)+`,"title":"Review beta"}`))
	if err != nil {
		t.Fatal(err)
	}
	var created SpaceTask
	if json.Unmarshal(result, &created) != nil || created.SpaceID != design.ID || created.Title != "Review beta" || created.CreatedByAgentID != personal.ID {
		t.Fatalf("global Agent Task = %s", result)
	}

	_, err = api.TestingExecuteGlobalAgentTaskTool(ctx, database, owner.ID, personal.ID,
		"Create a task called Review beta in Design Space", "tasks.create",
		json.RawMessage(`{"space_id":`+strconv.Quote(finance.ID)+`,"title":"Review beta"}`))
	if !errors.Is(err, workflowv2.ErrCapabilityDenied) {
		t.Fatalf("unnamed target Space error = %v, want capability denied", err)
	}
}

func TestBuiltInSpaceAgentRenamesSpaceThroughToolbox(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Rename Owner", "space-rename-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	space, err := database.CreateSpace(ctx, owner.ID, "Planning")
	if err != nil {
		t.Fatal(err)
	}

	result, err := api.TestingExecuteSpaceConversationTool(
		ctx, database, owner.ID, space.ID, "",
		"Rename this Space to Launch Operations",
		"spaces.rename", json.RawMessage(`{"name":"Launch Operations"}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	var renamed Space
	if json.Unmarshal(result, &renamed) != nil || renamed.Name != "Launch Operations" {
		t.Fatalf("rename result = %s", result)
	}
	stored, err := database.SpaceByID(ctx, owner.ID, space.ID)
	if err != nil || stored.Name != "Launch Operations" {
		t.Fatalf("stored Space = %#v, %v", stored, err)
	}
}

func TestSpaceRenameToolboxRechecksOwnerAgentAndGrounding(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Rename Guard Owner", "space-rename-guard-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	member, err := database.CreateUser("Rename Guard Member", "space-rename-guard-member@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	space, err := database.CreateSpace(ctx, owner.ID, "Guarded")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := database.InviteToSpace(ctx, owner.ID, space.ID, member.Email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.RespondToSpaceInvite(ctx, member.ID, invite.ID, true); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name, userID, agentID, prompt, requestedName string
	}{
		{"member", member.ID, "", "Rename this Space to Member Name", "Member Name"},
		{"custom Agent", owner.ID, "personal-agent", "Rename this Space to Agent Name", "Agent Name"},
		{"ungrounded arguments", owner.ID, "", "Rename this Space to Approved Name", "Injected Name"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := api.TestingExecuteSpaceConversationTool(
				ctx, database, test.userID, space.ID, test.agentID, test.prompt,
				"spaces.rename", json.RawMessage(`{"name":`+strconv.Quote(test.requestedName)+`}`),
			)
			if !errors.Is(err, workflowv2.ErrCapabilityDenied) {
				t.Fatalf("rename error = %v, want capability denied", err)
			}
		})
	}
}
