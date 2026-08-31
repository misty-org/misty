import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  conversations: vi.fn(),
  run: vi.fn(),
}));

vi.mock("./globalMistyApi", () => ({
  globalMistyApi: {
    conversations: mocks.conversations,
  },
}));

vi.mock("@/api/agents/api", () => ({
  agentsApi: {
    run: mocks.run,
  },
}));

import { useGlobalSearchStore } from "./useGlobalSearchStore";

describe("Global Misty durable Agent progress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.conversations.mockResolvedValue({
      conversations: [
        {
          id: "conversation-1",
          title: "Draw a house",
          createdAt: "2026-08-25T05:30:00Z",
          updatedAt: "2026-08-25T05:30:05Z",
          remote: true,
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              mode: "action",
              content: "Misty is working on this task.",
              createdAt: "2026-08-25T05:30:05Z",
              action: {
                id: "action-1",
                title: "Misty task",
                summary: "Misty is working on this task.",
                prompt: "Draw a house",
                risk: "write",
                state: "running",
                requiresConfirmation: false,
                runId: "run-1",
              },
            },
          ],
        },
      ],
    });
    mocks.run.mockResolvedValue({ summary: { state: "completed", progress: 100 } });
    useGlobalSearchStore.getState().setAccount("account-1");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("resumes polling a running task restored from conversation history", async () => {
    await useGlobalSearchStore.getState().loadConversations();
    await vi.advanceTimersByTimeAsync(1_250);

    const message = useGlobalSearchStore.getState().conversations[0]?.messages[0];
    expect(mocks.run).toHaveBeenCalledWith("run-1");
    expect(message?.action?.state).toBe("completed");
    expect(message?.content).toContain("finished");
  });
});
