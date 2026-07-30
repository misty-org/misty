package db

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestPersonalAgentOwnershipSharingAndMemoryIsolation(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Agent Owner", "personal-agent-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	member, err := database.CreateUser("Agent Member", "personal-agent-member@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	space, err := database.CreateSpace(ctx, owner.ID, "Agent Space")
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
	privateMember, err := database.CreateUser("Private Member", "personal-agent-private@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	privateInvite, err := database.InviteToSpace(ctx, owner.ID, space.ID, privateMember.Email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.RespondToSpaceInvite(ctx, privateMember.ID, privateInvite.ID, true); err != nil {
		t.Fatal(err)
	}
	privateConversation, err := database.CreateSpaceConversation(ctx, owner.ID, space.ID, "Private group", []string{privateMember.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := database.CreateSpaceConversationMessageWithReferences(ctx, owner.ID, space.ID, privateConversation.ID, []MessageSpan{{Type: "text", Text: "private group secret"}}, nil, nil, nil, ""); err != nil {
		t.Fatal(err)
	}
	memberContext, err := database.PersonalAgentSpaceContext(ctx, member.ID, space.ID, []byte(`{"space_chat":true}`))
	if err != nil || strings.Contains(memberContext, "private group secret") {
		t.Fatalf("Space-wide context leaked selected-member chat: %q, %v", memberContext, err)
	}
	privateContext, err := database.PersonalAgentSpaceContextForConversation(ctx, owner.ID, space.ID, privateConversation.ID, []byte(`{"space_chat":true}`))
	if err != nil || !strings.Contains(privateContext, "private group secret") {
		t.Fatalf("selected-member context = %q, %v", privateContext, err)
	}

	created, err := database.CreatePersonalAgent(ctx, owner.ID, PersonalAgent{
		Name: "Researcher", Description: "Finds relevant material", Instructions: "Prefer primary sources.",
		ModelMode: "pinned", ModelID: "google/gemini-2.5-flash-lite",
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.OwnerUserID != owner.ID || !created.Enabled || created.Version != 1 {
		t.Fatalf("created Agent = %#v", created)
	}
	if agents, err := database.AccessiblePersonalAgents(ctx, member.ID, space.ID); err != nil || len(agents) != 0 {
		t.Fatalf("private Agent visible to member: %#v, %v", agents, err)
	}

	grants, err := database.ReplacePersonalAgentGrants(ctx, owner.ID, created.ID, []PersonalAgentGrantInput{{
		SpaceID: space.ID, MemberUserIDs: []string{member.ID},
	}})
	if err != nil || len(grants) != 1 || len(grants[0].MemberUserIDs) != 1 {
		t.Fatalf("grants = %#v, %v", grants, err)
	}
	memberAgents, err := database.AccessiblePersonalAgents(ctx, member.ID, space.ID)
	if err != nil || len(memberAgents) != 1 {
		t.Fatalf("shared Agents = %#v, %v", memberAgents, err)
	}
	if memberAgents[0].Instructions != "" || len(memberAgents[0].ContextPermissions) != 0 || len(memberAgents[0].ToolPermissions) != 0 {
		t.Fatalf("shared Agent exposed private configuration: %#v", memberAgents[0])
	}

	if err := database.AppendPersonalAgentMemory(ctx, member.ID, space.ID, created.ID, "member question", "member answer"); err != nil {
		t.Fatal(err)
	}
	if err := database.AppendPersonalAgentMemory(ctx, owner.ID, space.ID, created.ID, "owner question", "owner answer"); err != nil {
		t.Fatal(err)
	}
	memberMemory, err := database.PersonalAgentMemoryContext(ctx, member.ID, space.ID, created.ID)
	if err != nil || !strings.Contains(memberMemory, "member question") || strings.Contains(memberMemory, "owner question") {
		t.Fatalf("member memory = %q, %v", memberMemory, err)
	}
	ownerMemory, err := database.PersonalAgentMemoryContext(ctx, owner.ID, space.ID, created.ID)
	if err != nil || !strings.Contains(ownerMemory, "owner question") || strings.Contains(ownerMemory, "member question") {
		t.Fatalf("owner memory = %q, %v", ownerMemory, err)
	}

	updated := *created
	updated.Name = "Research Guide"
	updatedAgent, err := database.UpdatePersonalAgent(ctx, owner.ID, updated)
	if err != nil || updatedAgent.Name != "Research Guide" || updatedAgent.Version != 2 {
		t.Fatalf("updated Agent = %#v, %v", updatedAgent, err)
	}
	if _, err := database.UpdatePersonalAgent(ctx, owner.ID, *created); !errors.Is(err, ErrPersonalAgentConflict) {
		t.Fatalf("stale update = %v, want ErrPersonalAgentConflict", err)
	}

	if _, err := database.ReplacePersonalAgentGrants(ctx, owner.ID, created.ID, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := database.PersonalAgentMemoryContext(ctx, member.ID, space.ID, created.ID); !errors.Is(err, ErrPersonalAgentNotFound) {
		t.Fatalf("revoked member memory read = %v, want ErrPersonalAgentNotFound", err)
	}
	if err := database.DeletePersonalAgent(ctx, owner.ID, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.PersonalAgentByID(ctx, owner.ID, created.ID); !errors.Is(err, ErrPersonalAgentNotFound) {
		t.Fatalf("deleted Agent lookup = %v, want ErrPersonalAgentNotFound", err)
	}
}
