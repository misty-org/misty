import { beforeEach, expect, it, vi } from "vitest";
import { ensureServerAgentDevice } from "./store/useAgentDeviceStore";
import { ManagedAiRequestError } from "./store/useAiServerStore";

const state = vi.hoisted(() => ({
  register: vi.fn(), invoke: vi.fn(), generation: 1, apiBase: "https://one.test/v1",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: state.invoke }));
vi.mock("@/api/devices/api", () => ({ devicesApi: { register: state.register } }));
vi.mock("@/api/client/session", () => ({
  readApiSessionGeneration: () => state.generation,
  isApiSessionTransitioning: () => false,
}));
vi.mock("@/api/deployment/api", () => ({
  resolveApiBase: async () => state.apiBase,
  deploymentStorageKey: (key: string) => key,
  readDeploymentStorageItem: () => null,
}));

beforeEach(() => {
  state.register.mockReset();
  state.invoke.mockReset().mockResolvedValue(JSON.stringify({ publicKey: "original", privateKey: "private" }));
  state.generation = 1;
  state.apiBase = "https://one.test/v1";
});

it("stops conflict retries for the same identity without modifying credentials, and isolates recovery scopes", async () => {
  const conflict = new ManagedAiRequestError("Restore original identity", 409, "device_identity_conflict");
  state.register.mockRejectedValue(conflict);
  const local = { id: "identity-conflict-device", displayName: "Mac" } as never;
  const connected = { endpointId: "endpoint-one", platform: "macos" as const };
  await expect(ensureServerAgentDevice(local, connected)).rejects.toBe(conflict);
  await expect(ensureServerAgentDevice(local, connected)).rejects.toBe(conflict);
  expect(state.register).toHaveBeenCalledTimes(1);
  expect(state.invoke).toHaveBeenCalledTimes(1);
  expect(state.invoke).toHaveBeenCalledWith("agents_device_identity_load", { localDeviceId: "identity-conflict-device" });

  state.register.mockResolvedValue({ id: "registered", name: "Mac" });
  await expect(ensureServerAgentDevice(local, { ...connected, endpointId: "endpoint-two" })).resolves.toMatchObject({ id: "registered" });
  state.generation++;
  await expect(ensureServerAgentDevice(local, connected)).resolves.toMatchObject({ id: "registered" });
  state.apiBase = "https://two.test/v1";
  state.generation = 1;
  await expect(ensureServerAgentDevice(local, connected)).resolves.toMatchObject({ id: "registered" });
  expect(state.register).toHaveBeenCalledTimes(4);
  expect(state.invoke).toHaveBeenCalledTimes(1);
});

it("does not permanently cache transient registration errors", async () => {
  const transient = new ManagedAiRequestError("Unavailable", 503);
  state.register.mockRejectedValueOnce(transient).mockResolvedValueOnce({ id: "recovered", name: "Mac" });
  const local = { id: "transient-device" } as never;
  const connected = { endpointId: "endpoint", platform: "macos" as const };
  await expect(ensureServerAgentDevice(local, connected)).rejects.toBe(transient);
  await expect(ensureServerAgentDevice(local, connected)).resolves.toMatchObject({ id: "recovered" });
  expect(state.register).toHaveBeenCalledTimes(2);
});


it("coalesces simultaneous registrations instead of racing the same device identity", async () => {
  let finish!: (value: { id: string; name: string }) => void;
  state.register.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const local = { id: "concurrent-device", displayName: "Mac" } as never;
  const connected = { endpointId: "concurrent-endpoint", platform: "macos" as const };
  const first = ensureServerAgentDevice(local, connected);
  const second = ensureServerAgentDevice(local, connected);
  await vi.waitFor(() => expect(state.register).toHaveBeenCalledTimes(1));
  finish({ id: "same-device", name: "Mac" });
  const results = await Promise.all([first, second]);
  expect(results.map(result => result.id)).toEqual(["same-device", "same-device"]);
});
