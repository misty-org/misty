import { useAuth } from "@/features/auth";
import { withBuiltinService } from "@/features/builtin-services";
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

export interface ServerConnectedPeer {
  pairId: string;
  deviceId: string;
  name: string;
  platform: string;
  p2pEndpointId: string;
  protocolVersions: string[];
  addressing: unknown;
  protocolVersion?: string;
  connectionHint: "unknown" | "direct" | "relay";
  lastHeartbeatAt?: string | null;
  clipboardCanSend: boolean;
  clipboardCanReceive: boolean;
}

export interface PairingSession {
  id: string;
  creatorDeviceId: string;
  requesterDeviceId?: string;
  state: "pending" | "redeemed" | "confirmed" | "expired" | "locked";
  expiresAt: string;
  creatorName: string;
  requesterName?: string;
}

export interface PairingView {
  session: PairingSession;
  manualCode?: string;
  deepLink?: string;
  fingerprint?: string;
}

const refreshIntervalMs = 30_000;

export function useConnectedDevices() {
  const spaceId = "personal";
  const { user } = useAuth();
  const accountId = user?.id;
  const packaged = hasTauriInternals() && platform() === "macos";
  const [deviceInstance, setDeviceInstance] = useState("");
  const [serviceError, setServiceError] = useState("");
  useEffect(() => {
    if (!packaged || !accountId) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    setDeviceInstance("");
    const start = async () => {
      let detach = () => {};
      try {
        setServiceError("");
        await withBuiltinService(
          "files",
          spaceId,
          (instance) =>
            new Promise<void>((resolve) => {
              if (controller.signal.aborted) {
                resolve();
                return;
              }
              setDeviceInstance(instance);
              const stop = () => resolve();
              controller.signal.addEventListener("abort", stop, { once: true });
              detach = () => {
                controller.signal.removeEventListener("abort", stop);
                resolve();
              };
            }),
          controller.signal,
          "devices",
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          setDeviceInstance("");
          setServiceError(
            error instanceof Error ? error.message : "Files device service is unavailable.",
          );
        }
      } finally {
        detach();
        if (!controller.signal.aborted) retry = setTimeout(() => void start(), refreshIntervalMs);
      }
    };
    void start();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [packaged, accountId, spaceId]);
  const [snapshot, setSnapshot] = useState<ConnectedDevicesSnapshot | null>(null);
  const [peers, setPeers] = useState<ServerConnectedPeer[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingView | null>(null);
  const localRef = useRef<{ localId: string; serverId: string; name: string } | null>(null);
  const refreshInFlight = useRef(false);
  const currentScope = useRef("");
  currentScope.current = JSON.stringify([accountId, spaceId, deviceInstance]);

  // One-time work per device identity and endpoint: ticket keys, native
  // initialization and server registration. Repeating it on every heartbeat
  // re-registered the device and re-fetched keys every 30 seconds.
  const setupRef = useRef<{
    scope: string;
    local: { localId: string; serverId: string; name: string };
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

  const createPairing = useCallback(async () => {
    const local = localRef.current;
    if (!local) throw new Error("Connected Devices is still starting.");
    const result = await devicesApi.createPairing<PairingView>(
      signedAgentDeviceRequest,
      local.localId,
      local.serverId,
    );
    setPairing(result);
    return result;
  }, []);

  const redeemPairing = useCallback(async (codeOrLink: string) => {
    const local = localRef.current;
    if (!local) throw new Error("Connected Devices is still starting.");
    const parsed = parsePairingInput(codeOrLink);
    const result = await devicesApi.redeemPairing<PairingView>(
      signedAgentDeviceRequest,
      local.localId,
      local.serverId,
      parsed,
    );
    setPairing(result);
    return result;
  }, []);

  const refreshPairing = useCallback(async () => {
    const local = localRef.current;
    if (!local || !pairing) return null;
    const result = await devicesApi.pairing<PairingView>(
      signedAgentDeviceRequest,
      local.localId,
      local.serverId,
      pairing.session.id,
    );
    setPairing((current) => ({
      ...result,
      manualCode: current?.manualCode,
      deepLink: current?.deepLink,
    }));
    return result;
  }, [pairing]);

  const confirmPairing = useCallback(async () => {
    const local = localRef.current;
    if (!local || !pairing) throw new Error("No pairing is ready to confirm.");
    await devicesApi.confirmPairing(
      signedAgentDeviceRequest,
      local.localId,
      local.serverId,
      pairing.session.id,
    );
    setPairing(null);
    await refresh();
  }, [pairing, refresh]);

  const setClipboardConsent = useCallback(
    async (peer: ServerConnectedPeer, enabled: boolean) => {
      const local = localRef.current;
      if (!local) return;
      await devicesApi.setClipboardConsent(
        signedAgentDeviceRequest,
        local.localId,
        local.serverId,
        peer.pairId,
        enabled,
      );
      await refresh();
    },
    [refresh],
  );

  const renamePeer = useCallback(
    async (peer: ServerConnectedPeer, name: string) => {
      const local = localRef.current;
      const trimmed = name.trim();
      if (!local || !trimmed) return;
      await devicesApi.renamePair(
        signedAgentDeviceRequest,
        local.localId,
        local.serverId,
        peer.pairId,
        trimmed,
      );
      await refresh();
    },
    [refresh],
  );

  const unpair = useCallback(
    async (peer: ServerConnectedPeer) => {
      const local = localRef.current;
      if (!local) return;
      await devicesApi.revokePair(
        signedAgentDeviceRequest,
        local.localId,
        local.serverId,
        peer.pairId,
      );
      await refresh();
    },
    [refresh],
  );

  return {
    localServerDeviceId: localRef.current?.serverId ?? null,
    localDeviceName: localRef.current?.name ?? "This Misty",
    snapshot,
    peers,
    loading,
    ready,
    error,
    pairing,
    setPairing,
    refresh,
    createPairing,
    redeemPairing,
    refreshPairing,
    confirmPairing,
    setClipboardConsent,
    renamePeer,
    unpair,
  };
}

export function connectedDevicesErrorMessage(cause: unknown): string {
  if (cause instanceof ManagedAiRequestError) {
    if (cause.status === 404) return "Connected Devices isn’t enabled on this Misty server.";
    if (cause.status === 503) return "Connected Devices is temporarily unavailable.";
    // Cloudflare edge failures (e.g. 1033: tunnel offline) arrive as a bare
    // "error code: NNNN" body. That means the server is unreachable, not broken.
    if (cause.status === 530 || /^error code: \d+$/i.test(cause.message.trim())) {
      return "Can’t reach the Misty server right now. Misty will keep retrying.";
    }
  }
  return cause instanceof Error ? cause.message : "Connected Devices is unavailable.";
}

export function peerIsOnline(peer: ServerConnectedPeer): boolean {
  const heartbeat = peer.lastHeartbeatAt ? Date.parse(peer.lastHeartbeatAt) : 0;
  return heartbeat > Date.now() - 90_000;
}

function connectedDevicePlatform(): "macos" | "windows" | "linux" | "unknown" {
  const value = navigator.userAgent.toLowerCase();
  if (value.includes("mac")) return "macos";
  if (value.includes("win")) return "windows";
  if (value.includes("linux")) return "linux";
  return "unknown";
}

function parsePairingInput(input: string): { sessionId?: string; secret?: string; code?: string } {
  const value = input.trim();
  if (value.startsWith("misty://")) {
    const url = new URL(value);
    return {
      sessionId: url.searchParams.get("session") || undefined,
      secret: url.searchParams.get("secret") || undefined,
    };
  }
  return { code: value.toUpperCase().replace(/[^A-Z2-7]/g, "") };
}
