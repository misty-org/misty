import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown) => undefined as unknown),
  sign: vi.fn(async (_account: unknown, grants: unknown[]) =>
    grants.map((_, index) => ({ payload: `p${index}`, signature: `s${index}` })),
  ),
  request: vi.fn(async (_path: string, _init?: unknown) => ({ state: "running" }) as unknown),
  events: undefined as undefined | ((event: { topic: string; id?: string }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/api/deployment/api", () => ({ resolveApiBase: async () => "https://api.example" }));
vi.mock("@/api/client", () => ({ apiRequest: mocks.request }));
vi.mock("@/api/accountEvents", () => ({
  subscribeAccountEvents: (_account: string, listener: typeof mocks.events) => {
    mocks.events = listener;
    return () => {
      mocks.events = undefined;
    };
  },
}));
vi.mock("@/features/auth/core", () => ({
  useUserStore: { getState: () => ({ me: { id: "account-1" } }) },
}));
vi.mock("@/features/ai-surface/api", () => ({
  aiSurfaceApi: { settings: async () => ({ settings: { keep_awake_for_agents: true } }) },
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/workspace/browserHome", () => ({ browserHomeUrl: () => "misty://home" }));
vi.mock("@/native/devices", () => ({ devicesNative: { signRunGrants: mocks.sign } }));
vi.mock("./store/useAgentsStore", () => ({
  agentsDeviceSnapshot: async () => ({
    device: { id: "local-1", status: "online", displayName: "Mac mini" },
  }),
}));
vi.mock("./store/useAgentDeviceStore", () => ({
  ensureServerAgentDevice: async () => ({ id: "device-b" }),
}));
import { endAllHostedSessions, endHostedSession, startHostedSession } from "./hostedSessions";
import { useHostedSessions } from "./hostedSessionsState";
import { DeviceOperationNotAttempted } from "./workerBrowserJobs";

const job = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "job-1",
    runId: "invocation-1",
    nodeId: "browser_session_call",
    scopeId: "workspace:device-b",
    operation: "browser.session",
    attempt: 1,
    input: {
      scopeId: "workspace:device-b",
      url: "https://forms.example/apply",
      conversationId: "conversation-1",
    },
    config: { agentId: "agent-1" },
    ...overrides,
  }) as Parameters<typeof startHostedSession>[0];

const commands = () => mocks.invoke.mock.calls.map(([command]) => command);

beforeEach(() => {
  vi.clearAllMocks();
  useHostedSessions.setState({ sessions: [] });
});
afterEach(async () => {
  await endAllHostedSessions();
});

it("opens a session under its own lease and returns a tab this device signed", async () => {
  const result = (await startHostedSession(job(), new AbortController().signal)) as {
    tabs: Array<Record<string, unknown> & { metadata: Record<string, unknown> }>;
  };
  const [session] = useHostedSessions.getState().sessions;
  expect(session).toMatchObject({ agentId: "agent-1", conversationId: "conversation-1" });
  expect(commands()).toEqual(
    expect.arrayContaining([
      "agent_workspace_acquire",
      "browser_webview_create",
      "agent_workspace_bind_scope",
      "browser_webview_hide",
    ]),
  );
  const create = mocks.invoke.mock.calls.find(([command]) => command === "browser_webview_create");
  expect((create?.[1] as { request: { url: string } }).request.url).toBe(
    "https://forms.example/apply",
  );
  expect(mocks.sign).toHaveBeenCalledWith(expect.anything(), [
    expect.objectContaining({
      targetDeviceId: "device-b",
      agentId: "agent-1",
      scopes: [session!.scopeId],
    }),
  ]);
  expect(result.tabs).toHaveLength(1);
  expect(result.tabs[0]).toMatchObject({
    device_id: "device-b",
    kind: "browser_tab",
    opaque_ref: session!.scopeId,
    run_grant: { payload: "p0", signature: "s0" },
  });
  expect(result.tabs[0]!.metadata).toMatchObject({
    app_id: "browser",
    remote_session: true,
    task_id: session!.taskId,
  });
  // The computer stays awake while the session runs.
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("power_keep_awake", { hold: true }),
  );
});

it("reuses the session for follow-ups in the same conversation", async () => {
  await startHostedSession(job(), new AbortController().signal);
  mocks.invoke.mockClear();
  await startHostedSession(job({ runId: "invocation-2" }), new AbortController().signal);
  expect(useHostedSessions.getState().sessions).toHaveLength(1);
  expect(useHostedSessions.getState().sessions[0]!.runId).toBe("invocation-2");
  expect(commands()).not.toContain("browser_webview_create");
});

it("refuses a job whose scope is not this device's browser", async () => {
  await expect(
    startHostedSession(
      job({ scopeId: "workspace:device-c", input: { scopeId: "workspace:device-c" } }),
      new AbortController().signal,
    ),
  ).rejects.toBeInstanceOf(DeviceOperationNotAttempted);
  expect(commands()).not.toContain("agent_workspace_acquire");
});

it("reports a busy agent without opening anything", async () => {
  mocks.invoke.mockImplementationOnce(async () => {
    throw new Error("agent_busy: this agent or window already has an active task");
  });
  await expect(startHostedSession(job(), new AbortController().signal)).rejects.toThrow(
    "agent_busy",
  );
  expect(commands()).not.toContain("browser_webview_create");
  expect(useHostedSessions.getState().sessions).toHaveLength(0);
});

it("ends with its lease, tabs and keep-awake released", async () => {
  await startHostedSession(job(), new AbortController().signal);
  const [session] = useHostedSessions.getState().sessions;
  await endHostedSession(session!.taskId);
  expect(useHostedSessions.getState().sessions).toHaveLength(0);
  expect(mocks.invoke).toHaveBeenCalledWith("agent_workspace_release", { taskId: session!.taskId });
  expect(mocks.invoke).toHaveBeenCalledWith("browser_webview_close", {
    request: { id: session!.viewId },
  });
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("power_keep_awake", { hold: false }),
  );
});

it("ends when the request that uses it is stopped on the other device", async () => {
  await startHostedSession(job(), new AbortController().signal);
  mocks.request.mockResolvedValueOnce({ state: "canceled" });
  mocks.events?.({ topic: "invocations", id: "invocation-1" });
  await vi.waitFor(() => expect(useHostedSessions.getState().sessions).toHaveLength(0));
  expect(mocks.request).toHaveBeenCalledWith("/ai/invocations/invocation-1/state", {
    cache: "no-store",
  });
});
