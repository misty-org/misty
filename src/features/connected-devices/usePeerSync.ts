import { devicesApi } from "@/api/devices/api";
import { signedAgentDeviceRequest } from "@/features/agents";
import {
  connectedDevicesConnect,
  connectedDevicesResumeSessions,
  connectedDevicesSyncPairs,
} from "@/native/connected-devices";
import type { ConnectedDevicesSnapshot } from "@/native/ipc";
import { useCallback } from "react";
import { connectsAutomatically, type ServerConnectedPeer } from "./connectedDeviceModel";
import type { LocalConnectedDevice } from "./useDevicePairing";

export type DeviceSetup = { scope: string; local: LocalConnectedDevice; endpointId: string };

/**
 * The account's view of paired devices, applied to this device's local
 * sessions. The native side reconnects sessions on its own; the server adds
 * fresh addresses and starts sessions for pairs that have never connected.
 */
export function usePeerSync(
  deviceInstance: string,
  setSnapshot: (snapshot: ConnectedDevicesSnapshot) => void,
  setPeers: (peers: ServerConnectedPeer[]) => void,
) {
  /** An explicit connect: one server ticket starts a session in both directions. */
  const connectPeer = useCallback(
    async (setup: DeviceSetup, peer: ServerConnectedPeer) => {
      if (!peer.addressing) throw new Error(`${peer.name} isn't reachable on this network.`);
      const issued = await devicesApi.issuePeerTicket<{ ticket: string }>(
        signedAgentDeviceRequest,
        setup.local.localId,
        setup.local.serverId,
        { targetDeviceId: peer.deviceId, protocolVersion: "misty-device/1" },
      );
      const native = await connectedDevicesConnect({
        instance: deviceInstance || undefined,
        deviceId: peer.deviceId,
        address: peer.addressing,
        ticket: issued.ticket,
      });
      setSnapshot(native);
      return native;
    },
    [deviceInstance, setSnapshot],
  );

  /** Peers change by push ("devices" account events). */
  const syncPeers = useCallback(
    async (setup: DeviceSetup, check: () => void) => {
      const response = await devicesApi.peers<{ peers: ServerConnectedPeer[] }>(
        signedAgentDeviceRequest,
        setup.local.localId,
        setup.local.serverId,
      );
      check();
      await connectedDevicesSyncPairs(
        response.peers.map((peer) => ({
          deviceId: peer.deviceId,
          acceptsWrites: peer.filesAcceptWrites,
          sharesClipboard: peer.clipboardCanSend,
        })),
      );
      const addresses = Object.fromEntries(
        response.peers.flatMap((peer) =>
          peer.addressing ? [[peer.deviceId, peer.addressing]] : [],
        ),
      );
      let native = await connectedDevicesResumeSessions(addresses);
      check();
      for (const peer of response.peers) {
        if (!connectsAutomatically(peer, native, setup.local.serverId)) continue;
        try {
          native = await connectPeer(setup, peer);
          check();
        } catch {
          // The device may have gone offline since presence; the next sync retries.
        }
      }
      setSnapshot(native);
      setPeers(response.peers);
    },
    [connectPeer, setPeers, setSnapshot],
  );

  return { syncPeers, connectPeer };
}
