import "./globalMistyState.testFixtures";
import { aiSurfaceApi } from "@/features/ai-surface";
import { useMistyStore } from "./useMistyStore";
import { expect, it, vi } from "vitest";
import { globalMistyApi } from "./globalMistyApi";

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
  const history = vi.spyOn(globalMistyApi, "conversations").mockResolvedValue({
    conversations: [
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
    ],
  });
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

it("shows the explicit workflow work location instead of the prior chat location", async () => {
  const create = vi
    .spyOn(aiSurfaceApi, "createInvocation")
    .mockRejectedValueOnce(new Error("fixture admission stop"));
  useMistyStore.setState({
    accountId: "account-a",
    activeConversationId: "method-chat",
    selectedAgentId: "default-misty",
    executionMode: "agent",
    working: false,
    conversations: [
      {
        id: "method-chat",
        agentId: "default-misty",
        title: "Method",
        spaceId: "work",
        createdAt: "2026-09-22",
        updatedAt: "2026-09-22",
        messages: [],
        remote: true,
      },
    ],
  });
  await useMistyStore
    .getState()
    .submitAnswer(
      "Method",
      [],
      undefined,
      "workspace",
      [],
      { conversationId: "method-chat", context: [] },
      { methodVersionId: "version-1", executionMode: "user" },
    );
  expect(useMistyStore.getState().executionMode).toBe("user");
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ executionMode: "user", methodVersionId: "version-1" }),
  );
  create.mockRestore();
});
