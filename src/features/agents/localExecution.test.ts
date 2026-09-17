import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  request: vi.fn(),
  apps: vi.fn(),
  cancel: vi.fn(),
  stream: vi.fn(),
  state: {
    working: false,
    invocationId: undefined as string | undefined,
    activeConversationId: "conversation",
    accountId: "owner",
    selectedSpaceId: "space",
    submitAnswer: vi.fn(),
  },
  destinations: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/api/agents/native", () => ({ personalAgentsApi: { apps: mocks.apps } }));
vi.mock("@/api/client", () => ({
  apiRequest: mocks.request,
  resolveRequiredApiBase: async () => "https://api.example.test",
}));
vi.mock("./taskArtifacts", () => ({ trackTaskArtifacts: async () => {} }));
vi.mock("./integrationDestinations", () => ({
  assignedIntegrationDestinations: mocks.destinations,
}));
vi.mock("./store/useAgentsStore", () => ({ agentsDeviceSnapshot: async () => ({ device: null }) }));
vi.mock("./store/useAgentDeviceStore", () => ({ ensureServerAgentDevice: vi.fn() }));
vi.mock("@/features/misty/useMistyStore", () => ({
  useMistyStore: {
    getState: () => mocks.state,
    setState: (next: object) => Object.assign(mocks.state, next),
  },
}));
vi.mock("@/features/global-search/globalSearchStoreHelpers", () => ({
  replaceActiveGlobalInvocationStream: mocks.stream,
}));
vi.mock("@/features/ai-surface/api", () => ({ aiSurfaceApi: { cancelInvocation: mocks.cancel } }));
import {
  startLocalExecution,
  routeLocalFollowup,
  pauseLocalExecution,
  settleLocalExecution,
  finishLocalExecution,
  useLocalExecution,
} from "./localExecution";
beforeEach(async () => {
  await finishLocalExecution();
  vi.clearAllMocks();
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
  mocks.invoke.mockResolvedValue(undefined);
  mocks.request.mockResolvedValue(undefined);
  mocks.apps.mockResolvedValue({ app_ids: ["planner"] });
  mocks.destinations.mockResolvedValue([]);
  mocks.cancel.mockResolvedValue(undefined);
  mocks.state.invocationId = undefined;
  mocks.state.accountId = "owner";
  mocks.state.submitAnswer.mockResolvedValue(undefined);
});
describe("native task authority", () => {
  it("rotates authority on resume and ignores stale completion", async () => {
    const first = await startLocalExecution("owner", "agent", "space", "agent");
    mocks.state.invocationId = "invocation-first";
    await pauseLocalExecution(first.taskId);
    expect(mocks.cancel).toHaveBeenCalledWith("invocation-first");
    expect(mocks.state.invocationId).toBeUndefined();
    const resumed = await startLocalExecution("owner", "agent", "space", "agent");
    expect(resumed.taskId).not.toBe(first.taskId);
    await settleLocalExecution("finished", first.taskId);
    expect(useLocalExecution.getState().execution?.state).toBe("running");
    await finishLocalExecution();
  });
  it("rejects another agent or Space while pages belong to a paused task", async () => {
    await startLocalExecution("owner", "agent", "space", "team");
    await pauseLocalExecution();
    await expect(startLocalExecution("owner", "other", "space", "team")).rejects.toThrow(
      "Stop the current task",
    );
    await expect(startLocalExecution("owner", "agent", "other-space", "team")).rejects.toThrow(
      "Stop the current task",
    );
  });
  it("does not resurrect work canceled during destination discovery", async () => {
    let resolve!: (value: []) => void;
    mocks.destinations.mockImplementation(() => new Promise<[]>((done) => (resolve = done)));
    const pending = startLocalExecution("owner", "agent", "space", "agent");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await pauseLocalExecution();
    resolve([]);
    await expect(pending).rejects.toThrow("Task paused");
    expect(useLocalExecution.getState().execution?.state).toBe("paused");
  });
  it("still cancels the invocation when either lease release fails", async () => {
    await startLocalExecution("owner", "agent", "space", "agent");
    mocks.state.invocationId = "invocation-lost";
    mocks.invoke.mockRejectedValue(new Error("native window lost"));
    mocks.request.mockRejectedValue(new Error("offline"));
    await pauseLocalExecution();
    expect(mocks.cancel).toHaveBeenCalledWith("invocation-lost");
    expect(useLocalExecution.getState().execution?.state).toBe("paused");
  });
});

describe("model-led follow-ups", () => {
  it("quiesces execution before interpreting a correction", async () => {
    await startLocalExecution("owner", "agent", "space", "agent");
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/misty/agent-followup") {
        expect(useLocalExecution.getState().execution?.state).toBe("paused");
        return { route: "steer" };
      }
    });
    await routeLocalFollowup("Use Friday instead");
    expect(mocks.state.submitAnswer).toHaveBeenCalledWith("Use Friday instead");
  });
  it("queues an independent outcome and resumes the existing task", async () => {
    await startLocalExecution("owner", "agent", "space", "agent");
    mocks.request.mockImplementation(async (path: string) =>
      path === "/misty/agent-followup" ? { route: "queue" } : undefined,
    );
    await routeLocalFollowup("Then organize a separate event");
    expect(mocks.invoke).toHaveBeenCalledWith("agent_foreground_queue", {
      task: expect.objectContaining({
        accountId: "owner",
        agentId: "agent",
        spaceId: "space",
        prompt: "Then organize a separate event",
      }),
    });
    expect(mocks.state.submitAnswer).not.toHaveBeenCalledWith("Then organize a separate event");
  });
  it("leaves an explicit stop paused without submitting more work", async () => {
    await startLocalExecution("owner", "agent", "space", "agent");
    mocks.request.mockImplementation(async (path: string) =>
      path === "/misty/agent-followup" ? { route: "stop" } : undefined,
    );
    await expect(routeLocalFollowup("Cancel this task")).resolves.toContain("not been undone");
    expect(mocks.state.submitAnswer).not.toHaveBeenCalled();
    expect(useLocalExecution.getState().execution?.state).toBe("paused");
  });
  it("does not apply a late interpretation after the user stops again", async () => {
    await startLocalExecution("owner", "agent", "space", "agent");
    let resolve!: (value: { route: string }) => void;
    mocks.request.mockImplementation(async (path: string) =>
      path === "/misty/agent-followup"
        ? new Promise((done) => {
            resolve = done;
          })
        : undefined,
    );
    const pending = routeLocalFollowup("Use Friday");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await pauseLocalExecution();
    resolve({ route: "steer" });
    await expect(pending).rejects.toThrow("active task changed");
    expect(mocks.state.submitAnswer).not.toHaveBeenCalled();
  });
  it("does not continue when the routing service is unavailable", async () => {
    await startLocalExecution("owner", "agent", "space", "agent");
    mocks.request.mockRejectedValue(new Error("offline"));
    await expect(routeLocalFollowup("Use Friday")).rejects.toThrow("offline");
    expect(mocks.state.submitAnswer).not.toHaveBeenCalled();
    expect(useLocalExecution.getState().execution?.state).toBe("paused");
  });
});
