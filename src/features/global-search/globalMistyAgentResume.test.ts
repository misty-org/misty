import { initializeHostAgentsRuntime } from "@/features/agents/hostAgentsRuntime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  conversations: vi.fn(),
  run: vi.fn(),
  decideApproval: vi.fn(),
  event: undefined as undefined | ((event: { topic: string; id?: string }) => void),
  unsubscribe: vi.fn(),
}));

vi.mock("@/api/accountEvents", () => ({
  subscribeAccountEvents: (_account: string, callback: typeof mocks.event) => {
    mocks.event = callback;
    return mocks.unsubscribe;
  },
}));

vi.mock("./globalMistyApi", () => ({
  globalMistyApi: {
    conversations: mocks.conversations,
  },
}));

vi.mock("@/features/misty/availability", () => ({
  assertMistyAvailable: vi.fn(async () => {}),
}));

vi.mock("@/api/agents/api", () => ({
  agentsApi: {
    run: mocks.run,
    decideApproval: (...args: unknown[]) => mocks.decideApproval(...args),
  },
}));

import { useMistyStore as useGlobalSearchStore } from "@/features/misty/useMistyStore";

initializeHostAgentsRuntime();

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
    useGlobalSearchStore.getState().setAccount("");
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("reconciles a running task restored from conversation history", async () => {
    await useGlobalSearchStore.getState().loadConversations();
    await vi.advanceTimersByTimeAsync(1_250);

    const message = useGlobalSearchStore.getState().conversations[0]?.messages[0];
    expect(mocks.run).toHaveBeenCalledWith("run-1");
    expect(message?.action?.state).toBe("completed");
    expect(message?.content).toContain("finished");
  });

  it("does not poll idle runs, coalesces notifications, and stops at completion", async () => {
    mocks.run.mockResolvedValue({ summary: { state: "running" } });
    await useGlobalSearchStore.getState().loadConversations();
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    mocks.event?.({ topic: "runs", id: "another-run" });
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    mocks.run.mockResolvedValue({ summary: { state: "completed" } });
    mocks.event?.({ topic: "runs", id: "run-1" });
    mocks.event?.({ topic: "runs", id: "run-1" });
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.unsubscribe).toHaveBeenCalled();
    expect(useGlobalSearchStore.getState().conversations[0]?.messages[0]?.action?.state).toBe(
      "completed",
    );
  });

  it("confirms and rejects personal agent run approvals via agentsApi.decideApproval", async () => {
    mocks.decideApproval.mockResolvedValue({});
    useGlobalSearchStore.setState({
      accountId: "account-1",
      conversations: [
        {
          id: "conversation-approval",
          title: "Approve action",
          createdAt: "2026-08-25T05:30:00Z",
          updatedAt: "2026-08-25T05:30:05Z",
          remote: true,
          messages: [
            {
              id: "assistant-approval",
              role: "assistant",
              mode: "action",
              content: "Please review",
              createdAt: "2026-08-25T05:30:05Z",
              action: {
                id: "action-approval-1",
                title: "Create Pull Request",
                summary: "Will open PR on misty-org/misty",
                prompt: "Open PR",
                risk: "write",
                state: "awaiting_approval",
                requiresConfirmation: true,
                runId: "run-42",
                approvalId: "approval-99",
              },
            },
          ],
        },
      ],
    });

    await useGlobalSearchStore.getState().confirmAction("action-approval-1");
    expect(mocks.decideApproval).toHaveBeenCalledWith("run-42", "approval-99", "approve");

    useGlobalSearchStore.setState({
      conversations: [
        {
          id: "conversation-approval",
          title: "Approve action",
          createdAt: "2026-08-25T05:30:00Z",
          updatedAt: "2026-08-25T05:30:05Z",
          remote: true,
          messages: [
            {
              id: "assistant-approval",
              role: "assistant",
              mode: "action",
              content: "Please review",
              createdAt: "2026-08-25T05:30:05Z",
              action: {
                id: "action-approval-1",
                title: "Create Pull Request",
                summary: "Will open PR on misty-org/misty",
                prompt: "Open PR",
                risk: "write",
                state: "awaiting_approval",
                requiresConfirmation: true,
                runId: "run-42",
                approvalId: "approval-99",
              },
            },
          ],
        },
      ],
    });

    useGlobalSearchStore.getState().rejectAction("action-approval-1");
    expect(mocks.decideApproval).toHaveBeenCalledWith("run-42", "approval-99", "deny");
  });
});
