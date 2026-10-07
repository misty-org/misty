import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { openAgentWindow, stopAgentWindowTask, showAgentWindow } from "./agentWindowHandoff";

const task = {
  queueId: "voice-session-1:call",
  accountId: "owner",
  agentId: "agent",
  spaceId: "",
  conversationId: "conversation",
  prompt: "Research this topic",
  attachments: [],
  companion: { executionMode: "team" as const, idempotencyKey: "voice-session-1:call" },
};
beforeEach(() => {
  mocks.invoke.mockReset();
});
afterEach(async () => {
  mocks.invoke.mockResolvedValue(null);
  await stopAgentWindowTask();
  vi.useRealTimers();
});

it("returns the durable worker admission without creating or controlling a view in main", async () => {
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "agent_window_task_receipt"
      ? { invocationId: "invocation", eventsUrl: "/ai/invocations/invocation/events" }
      : "worker",
  );
  const receipt = await openAgentWindow(task, "Misty", () => {});
  expect(receipt.invocationId).toBe("invocation");
  expect(mocks.invoke.mock.calls.map(([name]) => name)).toEqual([
    "agent_window_open",
    "agent_window_task_receipt",
  ]);
  expect(mocks.invoke).toHaveBeenCalledWith("agent_window_open", {
    request: expect.objectContaining({ task }),
  });
});

it("waits for admission rather than treating opening a window as task success", async () => {
  vi.useFakeTimers();
  mocks.invoke
    .mockResolvedValueOnce("worker")
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ invocationId: "run", eventsUrl: "/events" });
  let completed = false;
  const result = openAgentWindow(task, "Misty", () => {}).then(() => {
    completed = true;
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(completed).toBe(false);
  await vi.advanceTimersByTimeAsync(150);
  await result;
  expect(mocks.invoke.mock.calls.filter(([name]) => name === "agent_window_open")).toHaveLength(1);
});

it("propagates worker failures without resubmission", async () => {
  mocks.invoke
    .mockResolvedValueOnce("worker")
    .mockResolvedValueOnce({ error: "Connection denied" });
  await expect(openAgentWindow(task, "Misty", () => {})).rejects.toThrow("Connection denied");
  expect(mocks.invoke.mock.calls.filter(([name]) => name === "agent_window_open")).toHaveLength(1);
});

it("rejects late admission after account or conversation ownership changes", async () => {
  let current = true;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "agent_window_task_receipt") {
      current = false;
      return { invocationId: "foreign", eventsUrl: "/events" };
    }
  });
  await expect(
    openAgentWindow(task, "Misty", () => {
      if (!current) throw new Error("Account changed");
    }),
  ).rejects.toThrow("Account changed");
});

it("stops only the exact handoff and fences a pending acknowledgement", async () => {
  vi.useFakeTimers();
  mocks.invoke.mockResolvedValue(null);
  const pending = openAgentWindow(task, "Misty", () => {});
  const rejected = expect(pending).rejects.toThrow("stopped");
  await vi.advanceTimersByTimeAsync(1);
  await stopAgentWindowTask();
  expect(mocks.invoke).toHaveBeenCalledWith("agent_window_task_receipt", {
    accountId: "owner",
    agentId: "agent",
    queueId: task.queueId,
    revoke: true,
  });
  await vi.advanceTimersByTimeAsync(150);
  await rejected;
});

it("preserves native string errors as actionable handoff errors", async () => {
  mocks.invoke.mockRejectedValueOnce("agent_task_mismatch");
  await expect(openAgentWindow(task, "Misty", () => {})).rejects.toThrow(
    "Agent window: agent_task_mismatch",
  );
});

it("focuses only the exact owner's existing agent window when explicitly requested", async () => {
  mocks.invoke.mockResolvedValue(undefined);
  await showAgentWindow("owner", "agent");
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("agent_window_show", {
    accountId: "owner",
    agentId: "agent",
  });
});
