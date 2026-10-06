import { useAuth } from "@/features/auth";
import { platform } from "@tauri-apps/plugin-os";
import { listen } from "@tauri-apps/api/event";
import {
  connectedDevicesInitialize,
  connectedDevicesSetIdentity,
  connectedDevicesSnapshot,
} from "@/native/connected-devices";
import { devicesApi } from "@/api/devices/api";
import {
  agentsDeviceSnapshot,
  deviceAccount,
  ensureDeviceStarted,
} from "@/features/agents/devices";
import type { ConnectedDevicesSnapshot } from "@/native/ipc";
import {
  devicesNative,
  type AgentSurface,
  type ChannelSnapshot,
  type DevicesView,
  type FileSharing,
  type PendingAdmission,
} from "@/native/devices";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  connectedDevicesErrorMessage,
  devicePeers,
  type AccountDevice,
} from "./connectedDeviceModel";
import { useFilesDeviceService } from "./useFilesDeviceService";

/**
 * The account's devices (docs/design/devices/BRIEF.md): added once, then
 * trusted for sync, agents and LAN file sharing through the root-signed list.
 * Presence and connections come from native events; nothing here polls.
 */
export function useConnectedDevices() {
  const { user } = useAuth();
  const accountId = user?.id;
  const desktop = hasTauriInternals();
  const packaged = desktop && platform() === "macos";
  const { deviceInstance, serviceError } = useFilesDeviceService(packaged, accountId);
  const [view, setView] = useState<DevicesView | null>(null);
  const [devices, setDevices] = useState<AccountDevice[]>([]);
  const [channel, setChannel] = useState<ChannelSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<ConnectedDevicesSnapshot | null>(null);
  const [pending, setPending] = useState<PendingAdmission[]>([]);
  const [unreachable, setUnreachable] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const scope = useRef("");
  scope.current = JSON.stringify([accountId, deviceInstance]);

  const reload = useCallback(async () => {
    const account = await deviceAccount();
    const [list, current, requests, connections] = await Promise.all([
      devicesApi.list<{ devices: AccountDevice[] }>(),
      devicesNative.view(account.accountId),
      devicesNative.pendingRequests(account).catch(() => [] as PendingAdmission[]),
      connectedDevicesSnapshot().catch(() => null),
    ]);
    setDevices(list.devices);
    setView(current);
    setChannel(current.channel);
    setPending(requests);
    if (connections) setSnapshot(connections);
  }, []);

  // Start this device: register its key, verify trust, open the channel.
  useEffect(() => {
    if (!desktop || !accountId) {
      setLoading(false);
      if (!desktop) setError("Your devices are available in the Misty desktop app.");
      // Signed out: the channel, discovery and trust state close with the account.
      else void devicesNative.stop().catch(() => {});
      return;
    }
    const origin = scope.current;
    let active = true;
    void (async () => {
      try {
        const started = await ensureDeviceStarted();
        if (!active || origin !== scope.current) return;
        setView(started);
        setChannel(started.channel);
        if (!packaged || deviceInstance) {
          const local = await agentsDeviceSnapshot();
          if (local.device) {
            const native = await connectedDevicesInitialize({
              instance: deviceInstance || undefined,
              accountId,
              deviceId: local.device.id,
              deviceName: local.device.displayName,
            });
            // Initializing forgets the previous owner's id; name this device again.
            if (started.serverDeviceId) await connectedDevicesSetIdentity(started.serverDeviceId);
            if (active) setSnapshot(native);
          }
        }
        await reload();
        if (active) setError(packaged && !deviceInstance ? serviceError || null : null);
      } catch (cause) {
        if (active) setError(connectedDevicesErrorMessage(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [desktop, packaged, accountId, deviceInstance, serviceError, reload]);

  // Native events: presence, list hints, removal, and sync unlocking.
  useEffect(() => {
    if (!desktop || !accountId) return;
    const stops: Array<() => void> = [];
    let active = true;
    const subscribe = <T>(event: string, handler: (payload: T) => void) =>
      void listen<T>(event, ({ payload }) => handler(payload)).then((stop) => {
        if (active) stops.push(stop);
        else stop();
      });
    subscribe<ChannelSnapshot>("misty:devices-presence", (payload) => {
      setChannel(payload);
      void connectedDevicesSnapshot().then(setSnapshot, () => {});
    });
    subscribe<{ topic: string }>("misty:devices-event", ({ topic }) => {
      if (topic === "devices" || topic === "device-admission" || topic === "reset")
        void reload().catch(() => {});
    });
    subscribe<string>("misty:device-unreachable", (deviceId) =>
      setUnreachable((current) => new Set(current).add(deviceId)),
    );
    subscribe<null>("misty:device-removed", () => setRemoved(true));
    // Unlocking sync on this device is the proof that adds it.
    subscribe<string>("misty:browser-sync-changed", () => {
      void (async () => {
        const account = await deviceAccount();
        const current = await devicesNative.view(account.accountId);
        // Sync changes often; only an unlock that can add this device matters.
        if (current.admitted || !current.canSign) return;
        await devicesNative.admitSelf(account);
        await reload();
      })().catch(() => {});
    });
    return () => {
      active = false;
      stops.forEach((stop) => stop());
    };
  }, [desktop, accountId, reload]);

  const act = useCallback(
    async <T>(action: (account: Awaited<ReturnType<typeof deviceAccount>>) => Promise<T>) => {
      const result = await action(await deviceAccount());
      await reload().catch(() => {});
      return result;
    },
    [reload],
  );

  const peers = useMemo(
    () =>
      devicePeers(
        devices,
        view?.serverDeviceId ?? null,
        channel,
        snapshot?.peers.map((peer) => peer.deviceId) ?? view?.connected ?? [],
        unreachable,
      ),
    [devices, view, channel, snapshot, unreachable],
  );

  return {
    loading,
    ready: Boolean(view?.serverDeviceId),
    error,
    removed,
    view,
    snapshot,
    peers,
    devices,
    pending,
    localServerDeviceId: view?.serverDeviceId ?? null,
    localDeviceName: peers.find((peer) => peer.isSelf)?.name ?? "This Misty",
    refresh: () => act((account) => devicesNative.refresh(account)),
    connect: async (deviceId: string) => {
      setUnreachable((current) => {
        const next = new Set(current);
        next.delete(deviceId);
        return next;
      });
      await devicesNative.connect(deviceId);
    },
    rename: (deviceId: string, name: string) =>
      act((account) => devicesNative.rename(account, deviceId, name)),
    remove: (deviceId: string) => act((account) => devicesNative.remove(account, deviceId)),
    setPolicy: (policy: {
      files: FileSharing;
      clipboard: boolean;
      agentSurfaces: AgentSurface[];
    }) => act((account) => devicesNative.setPolicy(account, policy)),
    publishFolders: () => act((account) => devicesNative.publishFolders(account)),
    admitSelf: () => act((account) => devicesNative.admitSelf(account)),
    requestApproval: () => act((account) => devicesNative.requestApproval(account)),
    approvalStatus: (requestId: string) =>
      act((account) => devicesNative.approvalStatus(account, requestId)),
    approveStart: (requestId: string) =>
      act((account) => devicesNative.approveStart(account, requestId)),
    approveStatus: (requestId: string) =>
      act((account) => devicesNative.approveStatus(account, requestId)),
    approveConfirm: (requestId: string) =>
      act((account) => devicesNative.approveConfirm(account, requestId)),
    deny: (requestId: string) => act((account) => devicesNative.deny(account, requestId)),
  };
}
