import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  autopilot: false,
  account: "owner",
  sessionGeneration: 0,
  transitioning: false,
  startAutopilot: vi.fn(),
  request: vi.fn(),
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
  deviceSnapshot: vi.fn(),
}));
vi.mock("./betaModes", () => ({ visibleAutopilotAvailable: () => mocks.autopilot }));
vi.mock("./workspaceAutopilot", () => ({ startWorkspaceAutopilot: mocks.startAutopilot }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main", setFocus: async () => {} }),
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/auth/core", () => ({
  useUserStore: { getState: () => ({ me: { id: mocks.account } }) },
}));
vi.mock("@/api/client/session", () => ({
  readApiSessionGeneration: () => mocks.sessionGeneration,
  isApiSessionTransitioning: () => mocks.transitioning,
}));
vi.mock("@/api/client", () => ({
  apiRequest: mocks.request,
  resolveRequiredApiBase: async () => "https://api.example.test",
}));
vi.mock("./taskArtifacts", () => ({ trackTaskArtifacts: async () => {} }));
vi.mock("./store/useAgentsStore", () => ({ agentsDeviceSnapshot: mocks.deviceSnapshot }));
vi.mock("./store/useAgentDeviceStore", () => ({
  ensureServerAgentDevice: async () => ({ id: "server-device" }),
}));
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
  mocks.autopilot = false;
  mocks.account = "owner";
  mocks.sessionGeneration = 0;
  mocks.transitioning = false;
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
  mocks.invoke.mockResolvedValue(undefined);
  mocks.request.mockResolvedValue(undefined);
  mocks.deviceSnapshot.mockResolvedValue({ device: { id: "device" } });
  mocks.cancel.mockResolvedValue(undefined);
  mocks.state.invocationId = undefined;
  mocks.state.accountId = "owner";
  mocks.state.submitAnswer.mockResolvedValue(undefined);
});
describe("native task authority", () => {
  it("opens the built-in browser without installations, using the workspace native profile", async () => {
    const execution = await startLocalExecution("owner", "agent", "", "agent");
    const create = mocks.invoke.mock.calls.find(([name]) => name === "browser_webview_create")![1]
      .request;
    expect(create.url).toBe("https://www.google.com");
    expect(create).not.toHaveProperty("profileId");
    expect(create).not.toHaveProperty("providerId");
    expect(mocks.request.mock.calls.every(([path]) => !path.includes("/apps"))).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("agent_workspace_acquire", {
      request: expect.objectContaining({ spaceId: "", accountId: "owner" }),
    });
    expect(execution.deviceContexts).toEqual([
      expect.objectContaining({
        capabilities: expect.arrayContaining([
          "browser.navigate",
          "browser.upload",
          "browser.downloads.list",
        ]),
        metadata: expect.objectContaining({ app_id: "browser", window_label: "main" }),
      }),
    ]);
  });
  it("rejects an account transition before acquiring authority", async () => {
    mocks.transitioning = true;
    await expect(startLocalExecution("owner", "agent", "", "agent")).rejects.toThrow(
      "account changed",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("rejects an account switch away and back during device discovery", async () => {
    let resolve!: (value: object) => void;
    mocks.deviceSnapshot.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = startLocalExecution("owner", "agent", "", "agent");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    mocks.sessionGeneration += 2;
    resolve({ device: { id: "device" } });
    await expect(pending).rejects.toThrow("account changed");
    expect(mocks.invoke).not.toHaveBeenCalledWith("browser_webview_create", expect.anything());
  });
  it("closes a view created after startup was canceled", async () => {
    let resolve!: () => void;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "browser_webview_create")
        await new Promise<void>((done) => {
          resolve = done;
        });
    });
    const pending = startLocalExecution("owner", "agent", "", "agent");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await pauseLocalExecution();
    resolve();
    await expect(pending).rejects.toThrow("Task paused");
    const create = mocks.invoke.mock.calls.find(([name]) => name === "browser_webview_create")![1]
      .request;
    expect(mocks.invoke).toHaveBeenCalledWith("browser_webview_close", {
      request: { id: create.id },
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("agent_workspace_bind_scope", expect.anything());
  });
  it("replaces retired app/provider profiles when resuming", async () => {
    const first = await startLocalExecution("owner", "agent", "", "agent");
    const oldView = first.views[0];
    useLocalExecution.setState({
      execution: {
        ...first,
        deviceContexts: first.deviceContexts.map((ref) => ({
          ...ref,
          metadata: { ...ref.metadata, profile_id: "old-installed-browser-profile" },
        })),
      },
    });
    await pauseLocalExecution();
    mocks.invoke.mockClear();
    const resumed = await startLocalExecution("owner", "agent", "", "agent");
    expect(mocks.invoke).toHaveBeenCalledWith("browser_webview_close", {
      request: { id: oldView },
    });
    expect(resumed.views).toHaveLength(1);
    expect(resumed.views[0]).not.toBe(oldView);
    expect(resumed.deviceContexts[0].metadata).not.toHaveProperty("profile_id");
  });
  it("cleans a partial startup before retrying scope binding", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "agent_workspace_bind_scope") throw new Error("binding failed");
    });
    await expect(startLocalExecution("owner", "agent", "", "agent")).rejects.toThrow(
      "binding failed",
    );
    expect(useLocalExecution.getState().execution?.state).toBe("paused");
    expect(useLocalExecution.getState().execution?.views).toEqual([]);
    expect(mocks.invoke).toHaveBeenCalledWith("browser_webview_close", expect.anything());
    mocks.invoke.mockResolvedValue(undefined);
    const resumed = await startLocalExecution("owner", "agent", "", "agent");
    expect(resumed.views).toHaveLength(1);
    expect(resumed.ready).toBe(true);
  });
  it("does not let a late startup failure pause its replacement task", async () => {
    let resolve!: () => void;
    let firstBinding = true;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "agent_workspace_bind_scope" && firstBinding) {
        firstBinding = false;
        await new Promise<void>((done) => {
          resolve = done;
        });
      }
    });
    const pending = startLocalExecution("owner", "agent", "", "agent");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const abandonedView = useLocalExecution.getState().execution!.views[0];
    await pauseLocalExecution();
    const replacement = await startLocalExecution("owner", "agent", "", "agent");
    resolve();
    await expect(pending).rejects.toThrow("Task paused");
    expect(replacement.views).toHaveLength(1);
    expect(replacement.views[0]).not.toBe(abandonedView);
    expect(replacement.deviceContexts).toHaveLength(1);
    expect(useLocalExecution.getState().execution).toMatchObject({
      taskId: replacement.taskId,
      state: "running",
      ready: true,
    });
  });
  it("rotates authority on resume and ignores stale completion", async () => {
    const first = await startLocalExecution("owner", "agent", "", "agent");
    mocks.state.invocationId = "invocation-first";
    await pauseLocalExecution(first.taskId);
    expect(mocks.cancel).toHaveBeenCalledWith("invocation-first");
    expect(mocks.state.invocationId).toBeUndefined();
    const resumed = await startLocalExecution("owner", "agent", "", "agent");
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
  it("explicitly carries task downloads only across a paused task's scope rebinding", async () => {
    const first = await startLocalExecution("owner", "agent", "", "agent");
    useLocalExecution.setState({
      execution: {
        ...first,
        views: ["view"],
        deviceContexts: [
          {
            deviceId: "device",
            kind: "browser_tab",
            opaqueRef: "source-scope",
            displayName: "Source",
            capabilities: ["browser.upload"],
            metadata: { app_id: "browser" },
          },
        ],
      },
    });
    await pauseLocalExecution();
    const resumed = await startLocalExecution("owner", "agent", "", "agent");
    expect(mocks.invoke).toHaveBeenCalledWith("agent_workspace_bind_scope", {
      taskId: resumed.taskId,
      scopeId: "source-scope",
      previousTaskId: first.taskId,
    });
    await settleLocalExecution("finished");
    mocks.invoke.mockClear();
    const next = await startLocalExecution("owner", "agent", "", "agent");
    expect(mocks.invoke).toHaveBeenCalledWith("agent_workspace_bind_scope", {
      taskId: next.taskId,
      scopeId: "source-scope",
      previousTaskId: undefined,
    });
  });
  it("does not resurrect work canceled during device discovery", async () => {
    let resolve!: (value: object) => void;
    mocks.deviceSnapshot.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    const pending = startLocalExecution("owner", "agent", "", "agent");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await pauseLocalExecution();
    resolve({ device: { id: "device" } });
    await expect(pending).rejects.toThrow("Task paused");
    expect(useLocalExecution.getState().execution?.state).toBe("paused");
  });
  it("still cancels the invocation when either lease release fails", async () => {
    await startLocalExecution("owner", "agent", "", "agent");
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
    await startLocalExecution("owner", "agent", "", "agent");
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
    await startLocalExecution("owner", "agent", "", "agent");
    mocks.request.mockImplementation(async (path: string) =>
      path === "/misty/agent-followup" ? { route: "queue" } : undefined,
    );
    await routeLocalFollowup("Then organize a separate event");
    expect(mocks.invoke).toHaveBeenCalledWith("agent_foreground_queue", {
      task: expect.objectContaining({
        accountId: "owner",
        agentId: "agent",
        spaceId: "",
        prompt: "Then organize a separate event",
      }),
    });
    expect(mocks.state.submitAnswer).not.toHaveBeenCalledWith("Then organize a separate event");
  });
  it("leaves an explicit stop paused without submitting more work", async () => {
    await startLocalExecution("owner", "agent", "", "agent");
    mocks.request.mockImplementation(async (path: string) =>
      path === "/misty/agent-followup" ? { route: "stop" } : undefined,
    );
    await expect(routeLocalFollowup("Cancel this task")).resolves.toContain("not been undone");
    expect(mocks.state.submitAnswer).not.toHaveBeenCalled();
    expect(useLocalExecution.getState().execution?.state).toBe("paused");
  });
  it("does not apply a late interpretation after the user stops again", async () => {
    await startLocalExecution("owner", "agent", "", "agent");
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
    await startLocalExecution("owner", "agent", "", "agent");
    mocks.request.mockRejectedValue(new Error("offline"));
    await expect(routeLocalFollowup("Use Friday")).rejects.toThrow("offline");
    expect(mocks.state.submitAnswer).not.toHaveBeenCalled();
    expect(useLocalExecution.getState().execution?.state).toBe("paused");
  });
});

it("visible control grants only whole-window tools and rejects Team startup", async () => {
  mocks.autopilot = true;
  const execution = await startLocalExecution("owner", "agent", "", "agent");
  expect(execution.autopilot).toBe(true);
  expect(mocks.startAutopilot).toHaveBeenCalledWith(execution.taskId, "owner", "");
  expect(execution.deviceContexts[0].capabilities).toEqual([
    "browser.workspace.visual",
    "browser.workspace.interact",
  ]);
  expect(execution.deviceContexts[0].metadata?.workspace_control).toBe(true);
  await finishLocalExecution();
  await expect(startLocalExecution("owner", "agent", "space", "team")).rejects.toThrow(
    "Only Agent mode",
  );
});
