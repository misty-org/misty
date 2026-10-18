import { describe, expect, it } from "vitest";
import type { SpaceConversation } from "@/api/spaces/dto/entities";
import { conversationPath } from "./chatRoute";
import { conversationName, groupConversations } from "./sidebar/conversationGroups";

const conversation = (patch: Partial<SpaceConversation>) =>
  ({
    id: "c",
    space_id: "home",
    title: "Launch",
    kind: "standard",
    participants: [],
    created_by_user_id: "me",
    created_at: "2026-10-16T00:00:00Z",
    updated_at: "2026-10-16T00:00:00Z",
    ...patch,
  }) as SpaceConversation;

describe("one chat system", () => {
  it("opens a chat with an agent in the agent view and everything else in Space chat", () => {
    expect(
      conversationPath("home", conversation({ id: "conversation_1", direct_agent_id: "agent_1" })),
    ).toBe("/agents?agent=agent_1&conversation=conversation_1");
    expect(conversationPath("home", conversation({ id: "c1" }))).toBe(
      "/spaces/home/social/misty?conversation=c1",
    );
  });

  it("lists chats with agents as direct messages, titled by the chat", () => {
    const agentChat = conversation({
      id: "conversation_1",
      kind: "direct",
      direct_agent_id: "agent_1",
      title: "Trip plans",
      updated_at: "2026-10-16T02:00:00Z",
    });
    const groups = groupConversations([conversation({ id: "c1" }), agentChat]);
    expect(groups.map((group) => group.conversations.map((item) => item.id))).toEqual([
      ["c1"],
      ["conversation_1"],
    ]);
    expect(conversationName(agentChat, "me")).toBe("Trip plans");
  });
});
