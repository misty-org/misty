import { useAuth } from "@/features/auth";
import { listen } from "@tauri-apps/api/event";
import { devicesApi } from "@/api/devices/api";
import { deviceAccount, ensureDeviceStarted } from "@/features/agents/devices";
import {
  devicesNative,
  type AgentSurface,
  type ChannelSnapshot,
  type DevicesView,
  type FileSharing,
  type PendingAdmission,
} from "@/native/devices";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectedDevicesErrorMessage,
  devicePeers,
  type AccountDevice,
} from "./connectedDeviceModel";

/**
 * The account's devices (docs/sync/devices.md): added once, then
 * trusted for sync, agents and the shared clipboard through the root-signed
 * list. Everything between devices goes through the server; presence comes
 * from native events and nothing here polls.
 */
export function useConnectedDevices() {
  const { user } = useAuth();
  const accountId = user?.id;
  const desktop = hasTauriInternals();
  const [view, setView] = useState<DevicesView | null>(null);
  const [devices, setDevices] = useState<AccountDevice[]>([]);
  const [channel, setChannel] = useState<ChannelSnapshot | null>(null);
  const [pending, setPending] = useState<PendingAdmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  const reload = useCallback(async () => {
    const account = await deviceAccount();
    const [list, current, requests] = await Promise.all([
      devicesApi.list<{ devices: AccountDevice[] }>(),
      devicesNative.view(account.accountId),
      devicesNative.pendingRequests(account).catch(() => [] as PendingAdmission[]),
    ]);
    setDevices(list.devices);
    setView(current);
    setChannel(current.channel);
    setPending(requests);
  }, []);

  // Start this device: register its key, verify trust, open the channel.
  useEffect(() => {
    if (!desktop || !accountId) {
      setLoading(false);
      if (!desktop) setError("Your devices are available in the Misty desktop app.");
      // Signed out: the channel and trust state close with the account.
      else void devicesNative.stop().catch(() => {});
      return;
    }
    let active = true;
    void (async () => {
      try {
        const started = await ensureDeviceStarted();
        if (!active) return;
        setView(started);
        setChannel(started.channel);
        await reload();
        if (active) setError(null);
      } catch (cause) {
        if (active) setError(connectedDevicesErrorMessage(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [desktop, accountId, reload]);

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
    subscribe<ChannelSnapshot>("misty:devices-presence", setChannel);
    subscribe<{ topic: string }>("misty:devices-event", ({ topic }) => {
      if (topic === "devices" || topic === "device-admission" || topic === "reset")
        void reload().catch(() => {});
    });
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
    () => devicePeers(devices, view?.serverDeviceId ?? null, channel),
    [devices, view, channel],
  );

  return {
    loading,
    ready: Boolean(view?.serverDeviceId),
    error,
    removed,
    view,
    peers,
    devices,
    pending,
    localServerDeviceId: view?.serverDeviceId ?? null,
    localDeviceName: peers.find((peer) => peer.isSelf)?.name ?? "This Misty",
    refresh: () => act((account) => devicesNative.refresh(account)),
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
