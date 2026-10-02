import { useAuth } from "@/features/auth";
import { platform } from "@tauri-apps/plugin-os";
import {
  connectedDevicesConnect,
  connectedDevicesInitialize,
  connectedDevicesSnapshot,
} from "@/native/connected-devices";
import { readActiveSavedAccountSession } from "@/features/auth";
import { devicesApi } from "@/api/devices/api";
import {
  agentsDeviceSnapshot,
  ensureServerAgentDevice,
  ManagedAiRequestError,
  noteServerAgentDeviceSeen,
  signedAgentDeviceRequest,
} from "@/features/agents";
import { subscribeAccountEvents } from "@/api/accountEvents";
import type { ConnectedDevicesSnapshot } from "@/native/ipc";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectedDevicePlatform,
  connectedDevicesErrorMessage,
  peerIsOnline,
  type ServerConnectedPeer,
} from "./connectedDeviceModel";
import { useDevicePairing, type LocalConnectedDevice } from "./useDevicePairing";
import { useFilesDeviceService } from "./useFilesDeviceService";

export {
  connectedDevicesErrorMessage,
  peerIsOnline,
  type PairingSession,
  type PairingView,
  type ServerConnectedPeer,
} from "./connectedDeviceModel";

const refreshIntervalMs = 30_000;

export function useConnectedDevices() {
  const spaceId = "personal";
  const { user } = useAuth();
  const accountId = user?.id;
  const packaged = hasTauriInternals() && platform() === "macos";
  const { deviceInstance, serviceError } = useFilesDeviceService(packaged, accountId);
  const [snapshot, setSnapshot] = useState<ConnectedDevicesSnapshot | null>(null);
  const [peers, setPeers] = useState<ServerConnectedPeer[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localRef = useRef<LocalConnectedDevice | null>(null);
  const refreshInFlight = useRef(false);
  const currentScope = useRef("");
  currentScope.current = JSON.stringify([accountId, spaceId, deviceInstance]);

  // One-time work per device identity and endpoint: ticket keys, native
  // initialization and server registration. Repeating it on every heartbeat
  // re-registered the device and re-fetched keys every 30 seconds.
  const setupRef = useRef<{
    scope: string;
    local: LocalConnectedDevice;
    endpointId: string;
  } | null>(null);

  const ensureSetup = useCallback(
    async (check: () => void) => {
      const account = readActiveSavedAccountSession();
      const localSnapshot = await agentsDeviceSnapshot();
      check();
      const local = localSnapshot.device;
      if (!account || !local) {
        setupRef.current = null;
        localRef.current = null;
        setReady(false);
        throw new Error("Sign in to connect this device.");
      }
      const scope = JSON.stringify([currentScope.current, account.id, local.id, local.displayName]);
      const existing = setupRef.current;
      if (existing?.scope === scope) return existing;
      const keyResponse = await devicesApi.peerTicketKeys<{
        algorithm: "Ed25519";
        keys: Record<string, string>;
      }>();
      check();
      const native = await connectedDevicesInitialize({
        instance: deviceInstance || undefined,
        accountId: account.id,
        deviceId: local.id,
        deviceName: local.displayName,
        developmentTicketKeys: keyResponse.keys,
      });
      check();
      if (!native.enabled || !native.endpointId || !native.addressing) {
        setSnapshot(native);
        setReady(false);
        throw new Error(native.unavailableReason || "Connected Devices is unavailable.");
      }
      const server = await ensureServerAgentDevice(local, {
        endpointId: native.endpointId,
        platform: connectedDevicePlatform(),
      });
      check();
      const setup = {
        scope,
        local: { localId: local.id, serverId: server.id, name: local.displayName },
        endpointId: native.endpointId,
      };
      setupRef.current = setup;
      localRef.current = setup.local;
      // Pairing only needs the initialized native endpoint and registered server
      // device. Do not keep it blocked behind presence or peer discovery, which
      // may be temporarily unavailable while a user is trying to add a device.
      setSnapshot(native);
      setReady(true);
      return setup;
    },
    [deviceInstance],
  );

  /** Liveness: the one periodic call. It also refreshes agent eligibility on
   * servers that report deviceSeen, so the agent worker sends no heartbeat. */
  const sendPresence = useCallback(async (setup: NonNullable<typeof setupRef.current>) => {
    const native = await connectedDevicesSnapshot();
    const result = await devicesApi.presence<{ deviceSeen?: boolean }>(
      signedAgentDeviceRequest,
      setup.local.localId,
      setup.local.serverId,
      {
        endpointId: setup.endpointId,
        protocolVersion: "misty-device/1",
        connectionHint: "unknown",
        addressing: native.addressing,
      },
    );
    if (result?.deviceSeen) noteServerAgentDeviceSeen(setup.local.serverId);
  }, []);

  /** Peers change by push ("devices" account events); dial any online peer
   * this device is not yet connected to. */
  const syncPeers = useCallback(
    async (setup: NonNullable<typeof setupRef.current>, check: () => void) => {
      const response = await devicesApi.peers<{ peers: ServerConnectedPeer[] }>(
        signedAgentDeviceRequest,
        setup.local.localId,
        setup.local.serverId,
      );
      check();
      let currentNative = await connectedDevicesSnapshot();
      check();
      const connectedIds = new Set(
        currentNative.peers.filter((peer) => peer.state === "online").map((peer) => peer.deviceId),
      );
      for (const peer of response.peers) {
        if (!peerIsOnline(peer) || connectedIds.has(peer.deviceId) || !peer.addressing) continue;
        try {
          const issued = await devicesApi.issuePeerTicket<{ ticket: string }>(
            signedAgentDeviceRequest,
            setup.local.localId,
            setup.local.serverId,
            {
              targetDeviceId: peer.deviceId,
              protocolVersion: "misty-device/1",
            },
          );
          check();
          currentNative = await connectedDevicesConnect({
            instance: deviceInstance || undefined,
            deviceId: peer.deviceId,
            address: peer.addressing,
            ticket: issued.ticket,
          });
        } catch {
          // A peer can disappear between presence and dialing. Keep its row;
          // its next "devices" event or a later sync will retry.
        }
      }
      check();
      setSnapshot(currentNative);
      setPeers(response.peers);
    },
    [deviceInstance],
  );

  const pendingMode = useRef<"full" | "presence" | "peers" | null>(null);
  const refresh = useCallback(
    async (mode: "full" | "presence" | "peers" = "full") => {
      if (refreshInFlight.current) {
        // Run once more afterwards, at the widest mode requested meanwhile.
        pendingMode.current =
          pendingMode.current === "full" || mode === "full"
            ? "full"
            : pendingMode.current && pendingMode.current !== mode
              ? "full"
              : mode;
        return;
      }
      if (!hasTauriInternals()) {
        setReady(false);
        setLoading(false);
        setError("Network devices are available in the Misty desktop app.");
        return;
      }
      if (packaged && !deviceInstance) {
        localRef.current = null;
        setupRef.current = null;
        setSnapshot(null);
        setPeers([]);
        setReady(false);
        setLoading(false);
        setError(serviceError || "Starting the Files device service…");
        return;
      }
      refreshInFlight.current = true;
      const origin = currentScope.current;
      const check = () => {
        if (origin !== currentScope.current) throw new Error("Device session changed.");
      };
      try {
        const setup = await ensureSetup(check);
        if (mode !== "peers") await sendPresence(setup);
        check();
        if (mode !== "presence") await syncPeers(setup, check);
        setError(null);
      } catch (cause) {
        // A device the server no longer knows must register again.
        if (cause instanceof ManagedAiRequestError && cause.status === 404) setupRef.current = null;
        if (origin === currentScope.current) setError(connectedDevicesErrorMessage(cause));
      } finally {
        refreshInFlight.current = false;
        setLoading(false);
        const next = pendingMode.current;
        pendingMode.current = null;
        if (next) void refresh(next);
      }
    },
    [packaged, deviceInstance, serviceError, ensureSetup, sendPresence, syncPeers],
  );

  useEffect(() => {
    void refresh("full");
    // Presence is a liveness heartbeat for the 90-second online window; it
    // neither registers the device nor lists peers.
    const timer = window.setInterval(() => void refresh("presence"), refreshIntervalMs);
    const stopEvents = subscribeAccountEvents(accountId ?? "", (event) => {
      if (event.topic === "devices") void refresh("peers");
      if (event.topic === "reset") void refresh("full");
    });
    const onOnline = () => void refresh("full");
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(timer);
      stopEvents();
      window.removeEventListener("online", onOnline);
    };
  }, [accountId, refresh]);

  // Peers age out of the online window locally; re-render when the next one does.
  useEffect(() => {
    const expiries = peers
      .map((peer) => (peer.lastHeartbeatAt ? Date.parse(peer.lastHeartbeatAt) + 90_000 : 0))
      .filter((at) => at > Date.now());
    if (!expiries.length) return;
    const timer = window.setTimeout(
      () => setPeers((current) => [...current]),
      Math.min(...expiries) - Date.now() + 250,
    );
    return () => window.clearTimeout(timer);
  }, [peers]);

  const pairingActions = useDevicePairing(localRef, refresh);

  return {
    localServerDeviceId: localRef.current?.serverId ?? null,
    localDeviceName: localRef.current?.name ?? "This Misty",
    snapshot,
    peers,
    loading,
    ready,
    error,
    refresh,
    ...pairingActions,
  };
}
