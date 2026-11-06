import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), finish: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/api/account-events", () => ({ subscribeAccountEvents: () => () => {} }));
vi.mock("@/api/deployment/api", () => ({ resolveApiBase: async () => "http://server/v1" }));
vi.mock("@/api/devices/api", () => ({ devicesApi: { finishRuntimeDelivery: mocks.finish } }));
vi.mock("./store/useAgentDeviceStore", () => ({
  ensureServerAgentDevice: vi.fn(),
  signedAgentDeviceRequest: vi.fn(),
}));
vi.mock("./store/useAgentsStore", () => ({ agentsDeviceSnapshot: vi.fn() }));
import { RuntimeDeliveryWorker } from "./runtimeDeliveries";
import { recheckRunningJobs, watchRunningJob } from "./runningJobs";

type Deliver = (delivery: object, localId: string, deviceId: string) => Promise<void>;
const deliver = (operation: string) =>
  (new RuntimeDeliveryWorker() as unknown as { deliver: Deliver }).deliver(
    { id: "delivery", lease_id: "lease", operation, run_id: "run" },
    "local",
    "device",
  );

afterEach(() => vi.clearAllMocks());

it("a delivered cancel asks running jobs at once, and other deliveries don't", async () => {
  mocks.invoke.mockResolvedValue({ status: "ok" });
  const look = vi.fn();
  const stop = watchRunningJob(look);
  await deliver("invocation.start");
  expect(look).not.toHaveBeenCalled();
  await deliver("runtime.cancel");
  expect(look).toHaveBeenCalledOnce();
  stop();
  recheckRunningJobs();
  expect(look).toHaveBeenCalledOnce();
});
