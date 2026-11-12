import "./globalMistyState.testFixtures";
import { aiSurfaceApi } from "@/features/agents/runs/invocations";
import { useMistyStore } from "./useMistyStore";
import { expect, it, vi } from "vitest";
import { localChats } from "./localChats";

it("authenticates worker resume hints against canonical history without admitting work", async () => {
  const create = vi.spyOn(aiSurfaceApi, "createInvocation");
  const expected = {
    accountId: "account-a",
    agentId: "research",
    conversationId: "research-chat",
    invocationId: "resumed",
  };
  useMistyStore.setState({
    ...expected,
    selectedAgentId: "research",
    activeConversationId: "research-chat",
    working: false,
    invocationId: "old",
    error: null,
  });
  const history = vi.spyOn(localChats, "conversations").mockResolvedValue([
    {
      id: "research-chat",
      agentId: "research",
      title: "Research",
      spaceId: "work",
      createdAt: "2026-09-22",
      updatedAt: "2026-09-22",
      remote: true,
      messages: [
        {
          id: "reply",
          role: "assistant",
          content: "Done",
          state: "completed",
          invocationId: "resumed",
          mode: "ask",
          createdAt: "2026-09-22",
        },
      ],
    },
  ]);
  await useMistyStore.getState().loadConversations(true, { ...expected, invocationId: "forged" });
  expect(useMistyStore.getState().invocationId).toBe("old");
  await useMistyStore.getState().loadConversations(true, expected);
  expect(useMistyStore.getState()).toMatchObject({
    invocationId: "resumed",
    invocationConversationId: "research-chat",
    working: false,
  });
  expect(useMistyStore.getState().conversations[0].messages[0].content).toBe("Done");
  expect(create).not.toHaveBeenCalled();
  history.mockRestore();
});
