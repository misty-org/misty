import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown) => undefined as unknown),
  sign: vi.fn(async (_account: unknown, grants: unknown[]) =>
    grants.map((_, index) => ({ payload: `p${index}`, signature: `s${index}` })),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("@/api/deployment/api", () => ({ resolveApiBase: async () => "https://api.example" }));
vi.mock("@/features/auth/core", () => ({
  useUserStore: { getState: () => ({ me: { id: "account-1" } }) },
}));
vi.mock("@/features/workspace/browserHome", () => ({ browserHomeUrl: () => "misty://home" }));
vi.mock("@/native/devices", () => ({ devicesNative: { signRunGrants: mocks.sign } }));
vi.mock("./store/useAgentsStore", () => ({
  agentsDeviceSnapshot: async () => ({ device: { id: "local-1", status: "active" } }),
}));
vi.mock("./store/useAgentDeviceStore", () => ({
  ensureServerAgentDevice: async () => ({ id: "device-1" }),
}));
import { useHostedSessions } from "./hostedSessionsState";
import { useLocalExecution, type Execution } from "./localExecution";
import { childTabCapabilities, spawnChildTabs } from "./spawnChildTabs";
import { DeviceOperationNotAttempted } from "./workerBrowserJobs";

const execution = (state: Execution["state"] = "running"): Execution => ({
  taskId: "task-1",
  accountId: "account-1",
  agentId: "agent-1",
  spaceId: "",
  mode: "agent",
  state,
  views: ["agent-parent"],
  context: [],
  deviceContexts: [],
});
const job = (count: number, taskId = "task-1") => ({
  id: "job-1",
  runId: "run-1",
  nodeId: "n",
  scopeId: "agent-scope-parent",
  operation: "browser.spawn_tabs",
  attempt: 1,
  input: { scopeId: "agent-scope-parent", count },
  config: { taskId, agentId: "agent-1" },
});

beforeEach(() => {
  mocks.invoke.mockClear();
  mocks.sign.mockClear();
  useLocalExecution.setState({ execution: execution() });
});

it("opens one bound tab per sub-agent and signs each grant on this device", async () => {
  const result = (await spawnChildTabs(job(2), new AbortController().signal)) as {
    tabs: Array<Record<string, unknown>>;
  };
  expect(result.tabs).toHaveLength(2);
  const creates = mocks.invoke.mock.calls.filter(
    ([command]) => command === "browser_webview_create",
  );
  const binds = mocks.invoke.mock.calls.filter(
    ([command]) => command === "agent_workspace_bind_scope",
  );
  expect(creates).toHaveLength(2);
  // Each tab runs under the task's lease, so Stop ends the sub-agents too.
  expect(binds.map(([, args]) => (args as { taskId: string }).taskId)).toEqual([
    "task-1",
    "task-1",
  ]);
  expect(result.tabs[0]).toMatchObject({
    device_id: "device-1",
    kind: "browser_tab",
    run_grant: { payload: "p0", signature: "s0" },
  });
  const grants = mocks.sign.mock.calls[0]![1] as Array<{
    scopes: string[];
    capabilities: string[];
  }>;
  expect(grants.map((grant) => grant.scopes.length)).toEqual([1, 1]);
  // Sub-agents cannot start sub-agents of their own.
  expect(grants[0]!.capabilities).not.toContain("browser.spawn_tabs");
  expect(childTabCapabilities).toContain("browser.steps");
  expect(useLocalExecution.getState().execution?.childViews).toHaveLength(2);
});

it("refuses for another task, a stopped task or too many tabs, without opening any", async () => {
  for (const [count, taskId, state] of [
    [2, "task-2", "running"],
    [2, "task-1", "paused"],
    [5, "task-1", "running"],
    [0, "task-1", "running"],
  ] as const) {
    useLocalExecution.setState({ execution: execution(state) });
    await expect(
      spawnChildTabs(job(count, taskId), new AbortController().signal),
    ).rejects.toBeInstanceOf(DeviceOperationNotAttempted);
  }
  expect(mocks.invoke.mock.calls.some(([command]) => command === "browser_webview_create")).toBe(
    false,
  );
});

it("closes the tabs it opened when signing fails", async () => {
  mocks.sign.mockRejectedValueOnce(new Error("keychain locked"));
  await expect(spawnChildTabs(job(2), new AbortController().signal)).rejects.toBeInstanceOf(
    DeviceOperationNotAttempted,
  );
  const closes = mocks.invoke.mock.calls.filter(([command]) => command === "browser_webview_close");
  expect(closes).toHaveLength(2);
  expect(useLocalExecution.getState().execution?.childViews).toBeUndefined();
});

it("opens sub-agent tabs inside a session this device runs for another device", async () => {
  useLocalExecution.setState({ execution: null });
  useHostedSessions.setState({
    sessions: [
      {
        taskId: "hosted-task",
        conversationId: "conversation-1",
        accountId: "account-1",
        agentId: "agent-1",
        scopeId: "agent-scope-parent",
        viewId: "agent-parent",
        childViews: [],
        runId: "run-1",
        lastUsed: Date.now(),
      },
    ],
  });
  const result = (await spawnChildTabs(job(1, "hosted-task"), new AbortController().signal)) as {
    tabs: Array<{ metadata: Record<string, unknown> }>;
  };
  const binds = mocks.invoke.mock.calls.filter(
    ([command]) => command === "agent_workspace_bind_scope",
  );
  expect(binds.map(([, args]) => (args as { taskId: string }).taskId)).toEqual(["hosted-task"]);
  // The child's steps run under the session's task, not the asking device's.
  expect(result.tabs[0]!.metadata).toMatchObject({ remote_session: true, task_id: "hosted-task" });
  expect(useHostedSessions.getState().sessions[0]!.childViews).toHaveLength(1);
  useHostedSessions.setState({ sessions: [] });
});
