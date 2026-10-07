import { afterEach, expect, it, vi } from "vitest";
import { browserUncertainErrorCode } from "./workerDeviceJobs";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  begin: vi.fn(),
  uncertain: vi.fn(),
  fail: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@/api/accountEvents", () => ({ subscribeAccountEvents: () => () => {} }));
vi.mock("@/api/devices/api", () => ({
  devicesApi: {
    claimWorkflowJob: mocks.claim,
    beginWorkflowJob: mocks.begin,
    uncertainWorkflowJob: mocks.uncertain,
    failWorkflowJob: mocks.fail,
  },
}));
vi.mock("./store/useAgentsStore", () => ({
  agentsDeviceSnapshot: async () => ({ device: { id: "local", status: "online" } }),
}));
vi.mock("./store/useAgentDeviceStore", () => ({
  ensureServerAgentDevice: async () => ({ id: "server" }),
  heartbeatServerAgentDevice: async () => {},
  serverAgentDeviceSeenWithin: () => true,
  signedAgentDeviceRequest: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
// The job's run grant is checked natively before it runs.
vi.mock("@/native/devices", () => ({ devicesNative: { verifyJob: async () => {} } }));
import { DesktopAgentJobWorker } from "./worker";
let worker: DesktopAgentJobWorker | undefined;
afterEach(() => {
  worker?.stop();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("redacts native error details and retains unknown errors as uncertainty", () => {
  expect(browserUncertainErrorCode("Browser snapshot was invalid: private page contents")).toBe(
    "device_execution_uncertain:browser_snapshot_invalid",
  );
  expect(browserUncertainErrorCode(new Error("TypeError: private account data"))).toBe(
    "device_execution_uncertain:browser_script_error",
  );
  expect(browserUncertainErrorCode("agent_task_paused")).toBe(
    "device_execution_uncertain:agent_task_paused",
  );
  expect(browserUncertainErrorCode("agent_task_paused:native_lease_expired")).toBe(
    "device_execution_uncertain:agent_task_paused:native_lease_expired",
  );
  expect(browserUncertainErrorCode("agent_task_paused:private task identity")).toBe(
    "device_execution_uncertain:agent_task_paused",
  );
  expect(browserUncertainErrorCode("private unknown failure")).toBe("device_execution_uncertain");
});

it("reports a native rejection after begin as uncertain without repeating the operation", async () => {
  vi.useFakeTimers();
  const expiry = new Date(Date.now() + 60000).toISOString();
  const job = {
    id: "job",
    runId: "run",
    nodeId: "node",
    scopeId: "scope",
    contextId: "context",
    operation: "browser.inspect",
    attempt: 1,
    controlVersion: 2,
    deadlineAt: expiry,
    leaseExpiresAt: expiry,
    input: {},
    config: {
      agentId: "agent",
      contextCapabilities: ["browser.inspect"],
      contextExpiresAt: expiry,
    },
  };
  mocks.claim
    .mockResolvedValueOnce({ job, leaseToken: "lease", leaseExpiresAt: expiry })
    .mockResolvedValue(null);
  mocks.begin.mockResolvedValue(job);
  mocks.uncertain.mockResolvedValue({});
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "browser_runtime_for_scope") return "runtime";
    if (command === "browser_agent_execute_bounded")
      throw "Browser page returned invalid data: private details";
    return undefined;
  });
  worker = new DesktopAgentJobWorker();
  worker.start("account");
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.uncertain).toHaveBeenCalledWith(expect.anything(), "local", "server", "job", {
    leaseToken: "lease",
    errorCode: "device_execution_uncertain:browser_evaluation_invalid",
  });
  expect(mocks.fail).not.toHaveBeenCalled();
  expect(
    mocks.invoke.mock.calls.filter(([command]) => command === "browser_agent_execute_bounded"),
  ).toHaveLength(1);
});
