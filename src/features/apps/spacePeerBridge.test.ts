import { describe, it, expect, vi } from "vitest";
import { createAppRpcScope } from "./rpc/session";
import { createSpacePeerBridge, type SpacePeerBackend, type SpacePeerRow } from "./spacePeerBridge";
const snapshot = {
  endpointId: "space-endpoint",
  addressing: { id: "space-endpoint" },
  protocolVersion: "misty-device/2",
};
function fixture() {
  const scope = createAppRpcScope({
    identity: { appId: "files", accountId: "alice", spaceId: "family", instanceId: "view" },
    scopes: ["files.read", "connections.read"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const rows: SpacePeerRow[] = [
    {
      deviceId: "other-device",
      p2pEndpointId: "other-endpoint",
      addressing: { id: "other-endpoint" },
      protocolVersion: "misty-device/2",
      lastHeartbeatAt: new Date().toISOString(),
    },
  ];
  const invoke = vi.fn(async (command: string): Promise<unknown> => {
    if (command === "space_peer_start" || command === "space_peer_snapshot") return snapshot;
    if (command === "space_peer_connect")
      return { authorizationExpiresAt: Date.now() / 1000 + 300 };
    return undefined;
  });
  const backend = {
    invoke,
    authorize: vi.fn(async () => undefined),
    device: vi.fn(async () => ({ localId: "personal-device", serverId: "registered-device" })),
    keys: vi.fn(async () => ({ key: "public" })),
    presence: vi.fn(async () => undefined),
    peers: vi.fn(async () => rows),
    ticket: vi.fn(async () => "space-ticket"),
  };
  const bridge = createSpacePeerBridge(scope, {
    instance: async () => "native-view",
    installedVersion: "1.1.6",
    authorityGeneration: 7,
    folders: ["selected-folder"],
    backend: backend as SpacePeerBackend,
  });
  return { scope, bridge, backend, rows, invoke };
}
describe("Space peer bridge", () => {
  it("shares one refresh and scopes registration, presence and tickets to its environment", async () => {
    const f = fixture();
    try {
      const first = f.bridge.refresh();
      expect(f.bridge.refresh()).toBe(first);
      await first;
      expect(f.backend.device).toHaveBeenCalledWith("native-view");
      expect(f.backend.presence).toHaveBeenCalledWith(
        { localId: "personal-device", serverId: "registered-device" },
        "family",
        expect.objectContaining({
          endpointId: "space-endpoint",
          installedVersion: "1.1.6",
          authorityGeneration: 7,
        }),
      );
      expect(f.backend.ticket).toHaveBeenCalledWith(
        { localId: "personal-device", serverId: "registered-device" },
        "family",
        "other-device",
      );
      expect(f.invoke).toHaveBeenCalledWith("space_peer_start", {
        instance: "native-view",
        request: {
          localDeviceId: "personal-device",
          serverDeviceId: "registered-device",
          folders: ["selected-folder"],
          developmentTicketKeys: { key: "public" },
        },
      });
      f.rows.length = 0;
      await f.bridge.refresh();
      expect(f.invoke).toHaveBeenLastCalledWith("space_peer_set_peers", {
        instance: "native-view",
        peers: [],
      });
      expect(f.invoke.mock.calls.every(([name]) => !name.startsWith("connected_devices_"))).toBe(
        true,
      );
    } finally {
      f.scope.close();
    }
    expect(f.invoke).toHaveBeenCalledWith("space_peer_stop", { instance: "native-view" });
  });
  it("stops a late native startup after the app closes before it completes", async () => {
    const f = fixture();
    let finish!: (value: unknown) => void;
    f.invoke.mockImplementation(async (command) =>
      command === "space_peer_start"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : snapshot,
    );
    const refresh = f.bridge.refresh();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    f.scope.close();
    finish(snapshot);
    await expect(refresh).rejects.toThrow();
    expect(f.backend.presence).not.toHaveBeenCalled();
    expect(
      f.invoke.mock.calls.filter(([name]) => name === "space_peer_stop").length,
    ).toBeGreaterThanOrEqual(2);
  });
  it("closes execution on an authorization failure rather than treating it as an offline peer", async () => {
    const f = fixture();
    f.backend.ticket.mockRejectedValue(Object.assign(new Error("App removed"), { status: 403 }));
    await expect(f.bridge.refresh()).rejects.toThrow("App removed");
    expect(f.invoke).toHaveBeenCalledWith("space_peer_stop", { instance: "native-view" });
    f.scope.close();
  });
});
