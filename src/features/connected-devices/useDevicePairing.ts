import { useCallback, useState, type RefObject } from "react";
import { devicesApi } from "@/api/devices/api";
import { connectedDevicesEndSession } from "@/native/connected-devices";
import { signedAgentDeviceRequest } from "@/features/agents";
import {
  parsePairingInput,
  type PairingView,
  type ServerConnectedPeer,
} from "./connectedDeviceModel";

export type LocalConnectedDevice = { localId: string; serverId: string; name: string };

/** Pairing and per-peer actions, each signed by this device and followed by a refresh. */
export function useDevicePairing(
  localRef: RefObject<LocalConnectedDevice | null>,
  refresh: () => Promise<void>,
) {
  const [pairing, setPairing] = useState<PairingView | null>(null);
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
  }, [localRef]);

  const redeemPairing = useCallback(
    async (codeOrLink: string) => {
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
    },
    [localRef],
  );

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
  }, [localRef, pairing]);

  const confirmPairing = useCallback(async () => {
    const local = localRef.current;
    if (!local || !pairing) throw new Error("No pairing is ready to confirm.");
    await devicesApi.confirmPairing(
      signedAgentDeviceRequest,
      local.localId,
      local.serverId,
      pairing.session.id,
    );
    // Stay on the pairing so the dialog can show that the device connected.
    setPairing((current) =>
      current ? { ...current, session: { ...current.session, state: "confirmed" } } : current,
    );
    await refresh();
  }, [localRef, pairing, refresh]);

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
    [localRef, refresh],
  );

  /** Lets the peer change this device's files, or stops it. */
  const setFileWrites = useCallback(
    async (peer: ServerConnectedPeer, enabled: boolean) => {
      const local = localRef.current;
      if (!local) return;
      await devicesApi.setFileWrites(
        signedAgentDeviceRequest,
        local.localId,
        local.serverId,
        peer.pairId,
        enabled,
      );
      await refresh();
    },
    [localRef, refresh],
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
    [localRef, refresh],
  );

  const unpair = useCallback(
    async (peer: ServerConnectedPeer) => {
      const local = localRef.current;
      if (!local) return;
      // Tell the device now; it would otherwise learn at its next account sync.
      await connectedDevicesEndSession(peer.deviceId).catch(() => undefined);
      await devicesApi.revokePair(
        signedAgentDeviceRequest,
        local.localId,
        local.serverId,
        peer.pairId,
      );
      await refresh();
    },
    [localRef, refresh],
  );

  return {
    pairing,
    setPairing,
    createPairing,
    redeemPairing,
    refreshPairing,
    confirmPairing,
    setClipboardConsent,
    setFileWrites,
    renamePeer,
    unpair,
  };
}
