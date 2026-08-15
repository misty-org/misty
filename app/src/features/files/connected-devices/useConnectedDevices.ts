import {
  connectedDevicesConnect,
  connectedDevicesInitialize,
  connectedDevicesSnapshot,
} from "@/features/files/native";
import { readActiveSavedAccountSession } from "@/features/auth";
import { devicesApi } from "@/api/devices/api";
import {
  agentsDeviceSnapshot,
  ensureServerAgentDevice,
  ManagedAiRequestError,
  signedAgentDeviceRequest,
} from "@/features/agents";
import type { ConnectedDevicesSnapshot } from "@/native/contracts";
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
  const [snapshot, setSnapshot] = useState<ConnectedDevicesSnapshot | null>(null);
  const [peers, setPeers] = useState<ServerConnectedPeer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingView | null>(null);
  const localRef = useRef<{ localId: string; serverId: string } | null>(null);
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!hasTauriInternals() || refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const account = readActiveSavedAccountSession();
      const localSnapshot = await agentsDeviceSnapshot();
      const local = localSnapshot.device;
      if (!account || !local) throw new Error("Sign in to connect this device.");

      const keyResponse = await devicesApi.peerTicketKeys<{
        algorithm: "Ed25519";
        keys: Record<string, string>;
      }>();
      const native = await connectedDevicesInitialize({
        accountId: account.id,
        deviceId: local.id,
        deviceName: local.displayName,
        developmentTicketKeys: keyResponse.keys,
      });
      if (!native.enabled || !native.endpointId || !native.addressing) {
        throw new Error(native.unavailableReason || "Connected Devices is unavailable.");
      }
      const server = await ensureServerAgentDevice(local, {
        endpointId: native.endpointId,
        platform: connectedDevicePlatform(),
      });
      localRef.current = { localId: local.id, serverId: server.id };
      await devicesApi.presence(signedAgentDeviceRequest, local.id, server.id, {
        endpointId: native.endpointId,
        protocolVersion: "misty-device/1",
        connectionHint: "unknown",
        addressing: native.addressing,
      });
      const response = await devicesApi.peers<{ peers: ServerConnectedPeer[] }>(
        signedAgentDeviceRequest,
        local.id,
        server.id,
      );
      let currentNative = await connectedDevicesSnapshot();
      const connectedIds = new Set(
        currentNative.peers.filter((peer) => peer.state === "online").map((peer) => peer.deviceId),
      );
      for (const peer of response.peers) {
        if (!peerIsOnline(peer) || connectedIds.has(peer.deviceId) || !peer.addressing) continue;
        try {
          const issued = await devicesApi.issuePeerTicket<{ ticket: string }>(
            signedAgentDeviceRequest,
            local.id,
            server.id,
            {
              targetDeviceId: peer.deviceId,
              protocolVersion: "misty-device/1",
            },
          );
          currentNative = await connectedDevicesConnect({
            deviceId: peer.deviceId,
            address: peer.addressing,
            ticket: issued.ticket,
          });
        } catch {
          // A peer can disappear between presence and dialing. Keep its row;
          // the next heartbeat will retry without turning Files into an error state.
        }
      }
      setSnapshot(currentNative);
      setPeers(response.peers);
      setError(null);
    } catch (cause) {
      setError(connectedDevicesErrorMessage(cause));
    } finally {
      refreshInFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), refreshIntervalMs);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

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
    snapshot,
    peers,
    loading,
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
  }
  return cause instanceof Error ? cause.message : "Connected Devices is unavailable.";
}

export function peerIsOnline(peer: ServerConnectedPeer): boolean {
  const heartbeat = peer.lastHeartbeatAt ? Date.parse(peer.lastHeartbeatAt) : 0;
  return heartbeat > Date.now() - 90_000;
}

function connectedDevicePlatform(): "macos" | "windows" | "unknown" {
  const value = navigator.userAgent.toLowerCase();
  if (value.includes("mac")) return "macos";
  if (value.includes("win")) return "windows";
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
