import type { AppRpcScope } from "./rpc/session";

export interface SpacePeerRow {
  deviceId: string;
  p2pEndpointId: string;
  addressing: unknown;
  protocolVersion?: string;
  lastHeartbeatAt?: string | null;
}
interface EndpointSnapshot {
  endpointId: string;
  addressing: unknown;
  protocolVersion: "misty-device/2";
}
export interface SpacePeerBackend {
  invoke<T>(command: string, arguments_: Record<string, unknown>): Promise<T>;
  authorize(): Promise<void>;
  device(instance: string): Promise<{ localId: string; serverId: string }>;
  keys(): Promise<Record<string, string>>;
  presence(
    device: { localId: string; serverId: string },
    space: string,
    body: EndpointSnapshot & {
      installedVersion: string;
      authorityGeneration: number;
      connectionHint: "unknown";
    },
  ): Promise<unknown>;
  peers(device: { localId: string; serverId: string }, space: string): Promise<SpacePeerRow[]>;
  ticket(
    device: { localId: string; serverId: string },
    space: string,
    target: string,
  ): Promise<string>;
}
/** One compiled Host bridge per mounted Files instance. All execution and server
 * mutations name its Space; personal pairing identity is registered separately. */
export function createSpacePeerBridge(
  scope: AppRpcScope,
  options: {
    instance(): Promise<string>;
    installedVersion: string;
    authorityGeneration: number;
    folders: readonly string[];
    backend: SpacePeerBackend;
  },
) {
  const { backend } = options;
  let instance: string | undefined;
  let device: { localId: string; serverId: string } | undefined;
  let initialized = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let inFlight: Promise<SpacePeerRow[]> | undefined;
  const connected = new Map<string, { endpoint: string; expires: number }>();
  const folders = [...options.folders];
  const assert = () => {
    scope.assert("files.read");
    scope.assert("connections.read");
    if (
      disposed ||
      scope.identity.appId !== "files" ||
      !scope.identity.spaceId ||
      !options.installedVersion ||
      !Number.isSafeInteger(options.authorityGeneration) ||
      options.authorityGeneration < 1
    )
      throw new Error("A current Space Files installation is required for peer access.");
  };
  const checked = async <T>(operation: Promise<T>) => {
    const value = await operation;
    assert();
    return value;
  };
  const stop = async () => {
    initialized = false;
    connected.clear();
    if (instance) await backend.invoke("space_peer_stop", { instance }).catch(() => undefined);
  };
  const dispose = () => {
    disposed = true;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    scope.signal.removeEventListener("abort", dispose);
    void stop();
  };
  scope.signal.addEventListener("abort", dispose, { once: true });
  const run = async () => {
    try {
      assert();
      if (!initialized) {
        await checked(backend.authorize());
        instance = await checked(options.instance());
        device = await checked(backend.device(instance));
        const keys = await checked(backend.keys());
        await checked(
          backend.invoke<EndpointSnapshot>("space_peer_start", {
            instance,
            request: {
              localDeviceId: device.localId,
              serverDeviceId: device.serverId,
              folders,
              developmentTicketKeys: keys,
            },
          }),
        );
        initialized = true;
      }
      const currentDevice = device!;
      const space = scope.identity.spaceId!;
      const endpoint = await checked(
        backend.invoke<EndpointSnapshot>("space_peer_snapshot", { instance }),
      );
      if (endpoint.protocolVersion !== "misty-device/2")
        throw new Error("The Space peer protocol is incompatible.");
      await checked(
        backend.presence(currentDevice, space, {
          ...endpoint,
          installedVersion: options.installedVersion,
          authorityGeneration: options.authorityGeneration,
          connectionHint: "unknown",
        }),
      );
      const peers = await checked(backend.peers(currentDevice, space));
      const available = peers.filter(
        (peer) =>
          peer.protocolVersion === "misty-device/2" &&
          Date.parse(peer.lastHeartbeatAt ?? "") > Date.now() - 90_000 &&
          peer.p2pEndpointId &&
          peer.addressing,
      );
      await checked(
        backend.invoke("space_peer_set_peers", {
          instance,
          peers: available.map((peer) => ({
            deviceId: peer.deviceId,
            endpointId: peer.p2pEndpointId,
          })),
        }),
      );
      for (const [id, active] of connected)
        if (
          !available.some((peer) => peer.deviceId === id && peer.p2pEndpointId === active.endpoint)
        )
          connected.delete(id);
      for (const peer of available) {
        const active = connected.get(peer.deviceId);
        if (active?.endpoint === peer.p2pEndpointId && active.expires > Date.now() / 1000 + 30)
          continue;
        try {
          const ticket = await checked(backend.ticket(currentDevice, space, peer.deviceId));
          const result = await checked(
            backend.invoke<{ authorizationExpiresAt: number }>("space_peer_connect", {
              instance,
              request: {
                deviceId: peer.deviceId,
                endpointId: peer.p2pEndpointId,
                address: peer.addressing,
                ticket,
              },
            }),
          );
          connected.set(peer.deviceId, {
            endpoint: peer.p2pEndpointId,
            expires: result.authorizationExpiresAt,
          });
        } catch (error) {
          assert();
          if (
            error &&
            typeof error === "object" &&
            "status" in error &&
            (error.status === 401 || error.status === 403)
          )
            throw error;
          connected.delete(peer.deviceId);
          // Peers may disappear between listing and dialing. Other rows remain usable.
        }
      }
      return peers;
    } catch (error) {
      await stop();
      throw error;
    }
  };
  const refreshNow = (): Promise<SpacePeerRow[]> => {
    if (!inFlight)
      inFlight = run().finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
  let changing: Promise<void> = Promise.resolve();
  const refresh = () => changing.catch(() => undefined).then(refreshNow).then(peers => {
    if (!heartbeat && !disposed && initialized)
      heartbeat = setInterval(() => { void refresh().catch(() => undefined); }, 30_000);
    return peers;
  });
  const ready = async (deviceId: string) => {
    assert();
    const active = connected.get(deviceId);
    if (!initialized || !active || active.expires <= Date.now() / 1000 + 30) await refresh();
    assert();
    if (!instance || !connected.has(deviceId))
      throw new Error("This device is unavailable in the Space.");
    return instance;
  };
  return {
    refresh,
    setFolders(next: readonly string[]) {
      const selected = [...next];
      changing = changing.catch(() => undefined).then(async () => {
        assert();
        await inFlight?.catch(() => undefined);
        await stop();
        assert();
        const previous = [...folders];
        folders.splice(0, folders.length, ...selected);
        try { await refreshNow(); }
        catch (error) { folders.splice(0, folders.length, ...previous); throw error; }
      });
      return changing;
    },
    async request<T>(deviceId: string, request: Record<string, unknown>): Promise<T> {
      const owner = await ready(deviceId);
      try {
        return await checked(
          backend.invoke<T>("space_peer_request", { instance: owner, deviceId, request }),
        );
      } catch (error) {
        connected.delete(deviceId);
        throw error;
      }
    },
    async prepare(
      deviceId: string,
      request: {
        path: string;
        maxBytes: number;
        expectedSnapshot?: string;
      },
    ): Promise<{ handle: string; name: string; bytes: number; snapshot: string; writable: false }> {
      if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 0)
        throw new Error("Invalid prepared file size limit.");
      const owner = await ready(deviceId);
      let prepared:
        | { handle: string; name: string; bytes: number; snapshot: string; writable: false }
        | undefined;
      try {
        prepared = await backend.invoke("space_peer_prepare", {
          instance: owner,
          deviceId,
          request,
        });
        assert();
        return prepared!;
      } catch (error) {
        connected.delete(deviceId);
        if (prepared)
          await backend
            .invoke("mini_app_device_call", {
              instance: owner,
              method: "files.release",
              params: { handle: prepared.handle },
            })
            .catch(() => undefined);
        throw error;
      }
    },
    dispose,
  };
}
