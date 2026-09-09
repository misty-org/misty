import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAppRpcScope } from "./rpc/session";
import { createSpacePeerBackend } from "./spacePeerBackend";
const m = vi.hoisted(() => ({
  deployment: "hosted",
  snapshot: vi.fn(),
  register: vi.fn(),
  signed: vi.fn(),
  presence: vi.fn(),
  peers: vi.fn(),
  ticket: vi.fn(),
  keys: vi.fn(),
}));
vi.mock("@/api/deployment/api", () => ({ readDeploymentScope: () => m.deployment }));
vi.mock("@/features/agents", () => ({
  agentsDeviceSnapshot: m.snapshot,
  ensureServerAgentDevice: m.register,
  signedAgentDeviceRequest: m.signed,
}));
vi.mock("@/api/devices/api", () => ({
  devicesApi: {
    spacePresence: m.presence,
    spacePeers: m.peers,
    issueSpacePeerTicket: m.ticket,
    peerTicketKeys: m.keys,
  },
}));
function fixture() {
  const scope = createAppRpcScope({
    identity: { appId: "files", accountId: "alice", spaceId: "family", instanceId: "view" },
    scopes: ["files.read", "connections.read"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const invoke = vi.fn().mockResolvedValue("personal-pairing-endpoint");
  const native = vi.fn().mockResolvedValue(null);
  return { scope, invoke, native, backend: createSpacePeerBackend(scope, { invoke, native }) };
}
beforeEach(() => {
  vi.clearAllMocks();
  m.deployment = "hosted";
  m.snapshot.mockResolvedValue({ device: { id: "local-device", displayName: "Mac" } });
  m.register.mockResolvedValue({ id: "server-device" });
});
describe("authenticated Space peer backend", () => {
  it("registers the personal pairing identity without starting a global endpoint", async () => {
    const f = fixture();
    try {
      await f.backend.authorize();
      expect(f.native.mock.calls.map(([method]) => method)).toEqual([
        "files.sources.list",
        "connections.authorize",
      ]);
      expect(await f.backend.device("native-view")).toEqual({
        localId: "local-device",
        serverId: "server-device",
      });
      expect(f.invoke).toHaveBeenCalledWith("space_peer_local_identity", {
        instance: "native-view",
        deviceId: "local-device",
      });
      expect(m.register).toHaveBeenCalledWith(
        expect.objectContaining({ id: "local-device" }),
        expect.objectContaining({
          endpointId: "personal-pairing-endpoint",
          scope: { assertCurrent: expect.any(Function), signal: f.scope.signal },
        }),
      );
    } finally {
      f.scope.close();
    }
  });
  it("does not register a device after a late identity result outlives its app", async () => {
    const f = fixture();
    let resolve!: (value: string) => void;
    f.invoke.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = f.backend.device("native-view");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    f.scope.close();
    resolve("personal-key");
    await expect(pending).rejects.toThrow();
    expect(m.register).not.toHaveBeenCalled();
  });
  it("rejects another Space and a changed deployment before sending a signed request", async () => {
    const f = fixture();
    try {
      await expect(
        f.backend.ticket({ localId: "local", serverId: "server" }, "work", "peer"),
      ).rejects.toThrow("another Space");
      expect(m.ticket).not.toHaveBeenCalled();
      m.deployment = "another-server";
      await expect(
        f.backend.peers({ localId: "local", serverId: "server" }, "family"),
      ).rejects.toThrow("deployment changed");
      expect(m.peers).not.toHaveBeenCalled();
    } finally {
      f.scope.close();
    }
  });
});
