package db

import (
	"context"
	"testing"

	. "github.com/kannachi323/misty/server/internal/platform/postgres"
)

func TestAgentDirectConversationsAreCanonicalPerMemberAndSpace(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Agent owner", "canonical-agent-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	member, err := database.CreateUser("Agent member", "canonical-agent-member@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	space := createTestSpace(t, database, ctx, owner.ID, "Canonical conversations")
	invite, err := database.InviteToSpace(ctx, owner.ID, space.ID, member.Email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.RespondToSpaceInvite(ctx, member.ID, invite.ID, true); err != nil {
		t.Fatal(err)
	}
	agent, err := database.CreatePersonalAgent(ctx, owner.ID, PersonalAgent{
		Name: "Researcher", Instructions: "Answer from the current conversation.",
		ModelMode: "pinned", ModelID: "google/gemini-2.5-flash-lite",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.AddSpaceAgentMembership(
		ctx, owner.ID, space.ID, SpaceAgentMembershipInput{AgentID: agent.ID},
	); err != nil {
		t.Fatal(err)
	}
	first, err := database.DirectAgentConversation(ctx, owner.ID, space.ID, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	again, err := database.DirectAgentConversation(ctx, owner.ID, space.ID, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != again.ID || first.Kind != "direct" || len(first.Participants) != 2 {
		t.Fatalf("canonical direct conversation mismatch: %#v %#v", first, again)
	}
	memberDirect, err := database.DirectAgentConversation(ctx, member.ID, space.ID, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if memberDirect.ID == first.ID {
		t.Fatalf("different members shared direct conversation %q", first.ID)
	}
	group, err := database.CreateSpaceConversation(ctx, owner.ID, space.ID, "Research group", []SpaceActorRef{
		{Kind: "person", UserID: member.ID}, {Kind: "agent", AgentID: agent.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(group.Participants) != 3 {
		t.Fatalf("group participants = %#v", group.Participants)
	}
}
