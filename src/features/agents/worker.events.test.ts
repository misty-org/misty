import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  heartbeat: vi.fn(),
  event: undefined as undefined | ((event: { topic: string }) => void),
  remove: vi.fn(),
}));
vi.mock("@/api/accountEvents", () => ({
  subscribeAccountEvents: (_account: string, event: typeof mocks.event) => {
    mocks.event = event;
    return mocks.remove;
  },
}));
vi.mock("@/api/devices/api", () => ({ devicesApi: { claimWorkflowJob: mocks.claim } }));
vi.mock("./store/useAgentsStore", () => ({
  agentsDeviceSnapshot: async () => ({ device: { id: "local", status: "online" } }),
}));
vi.mock("./store/useAgentDeviceStore", () => ({
  ensureServerAgentDevice: async () => ({ id: "server" }),
  heartbeatServerAgentDevice: mocks.heartbeat,
  signedAgentDeviceRequest: vi.fn(),
}));
import { DesktopAgentJobWorker } from "./worker";
let worker: DesktopAgentJobWorker;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.claim.mockResolvedValue(null);
  mocks.heartbeat.mockResolvedValue({});
  worker = new DesktopAgentJobWorker();
});
afterEach(() => {
  worker.stop();
  vi.useRealTimers();
});

it("claims once on startup, then only on notifications while retaining device presence", async () => {
  worker.start("account");
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  expect(mocks.heartbeat).toHaveBeenCalledTimes(2);
  mocks.event?.({ topic: "jobs" });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.claim).toHaveBeenCalledTimes(2);
  worker.stop();
  mocks.event?.({ topic: "jobs" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.claim).toHaveBeenCalledTimes(2);
});

it("does not let new notifications bypass a claim cooldown", async () => {
  mocks.claim.mockRejectedValueOnce({ status: 429, retryAfterSeconds: 120 });
  worker.start("account");
  await vi.advanceTimersByTimeAsync(0);
  mocks.event?.({ topic: "jobs" });
  await vi.advanceTimersByTimeAsync(119_999);
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1_002);
  expect(mocks.claim).toHaveBeenCalledTimes(2);
});
