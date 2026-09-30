import { useEffect, useRef, useState } from "react";
import { useUserStore } from "@/features/auth/core";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { Button } from "@/shared/ui";
import { DesktopSettingsRow as Row } from "@/features/settings/desktop";
import { SwitchControl, TextControl } from "@/features/settings/SettingsControls";
import { deviceRows } from "./deviceControl";
import {
  claimNativeWorkspace,
  controlNativeDevice,
  readNativeSync,
  renameNativeDevice,
  type NativeSyncView,
} from "./native";
import { useBrowserSyncStore } from "./store";
import { onWorkspace } from "./workspaceControl";
import { captureBeforeSwitch, nativeCommandMs, withDeadline } from "./deadline";

type Pending = { deviceId: string; mode?: boolean; name?: string; started: number };
/** Shared roster for Overview and the popup. All mode changes await server acknowledgment. */
export function SyncDeviceList({
  session,
  compact = false,
}: {
  session: NativeSyncView;
  compact?: boolean;
}) {
  const ownerName = useUserStore((s) => s.me?.name);
  const rows = deviceRows(session, ownerName);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const requesting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let reading = false;
    const generation = readApiSessionGeneration();
    const read = async () => {
      if (
        stopped ||
        reading ||
        isApiSessionTransitioning() ||
        generation !== readApiSessionGeneration()
      )
        return;
      reading = true;
      try {
        const latest = await withDeadline(readNativeSync(), nativeCommandMs);
        if (
          !stopped &&
          generation === readApiSessionGeneration() &&
          !isApiSessionTransitioning() &&
          latest?.session_id === session.session_id &&
          latest.account_id === session.account_id &&
          useBrowserSyncStore.getState().session?.session_id === session.session_id
        )
          useBrowserSyncStore.setState({ session: latest });
      } catch {
        /* The shared sync status reports connection health. */
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      stopped = true;
      mounted.current = false;
      clearInterval(timer);
    };
  }, [session.session_id, session.account_id]);
  useEffect(() => {
    if (!pending) return;
    const device = session.devices?.find((d) => d.device_id === pending.deviceId);
    const confirmed =
      pending.name !== undefined
        ? device?.display_name === pending.name
        : pending.mode !== undefined
          ? device?.full_sync === pending.mode
          : onWorkspace(session) === pending.deviceId;
    if (confirmed) {
      setPending(null);
      setEditing(null);
      return;
    }
    const timer = setTimeout(
      () => {
        setPending(null);
        setError(
          "The device did not confirm the change. Check its connection and try the action again.",
        );
      },
      Math.max(0, 35000 - (Date.now() - pending.started)),
    );
    return () => clearTimeout(timer);
  }, [pending, session]);
  const change = async (request: Omit<Pending, "started">) => {
    if (pending || requesting.current || isApiSessionTransitioning()) return;
    requesting.current = true;
    setPending({ ...request, started: Date.now() });
    setError(null);
    const generation = readApiSessionGeneration();
    const valid = () =>
      mounted.current &&
      !isApiSessionTransitioning() &&
      generation === readApiSessionGeneration() &&
      useBrowserSyncStore.getState().session?.session_id === session.session_id;
    try {
      if (request.name !== undefined)
        await withDeadline(
          renameNativeDevice(session.session_id, request.deviceId, request.name),
          nativeCommandMs,
        );
      else if (request.mode !== undefined)
        await withDeadline(
          controlNativeDevice(session.session_id, request.deviceId, request.mode, false),
          nativeCommandMs,
        );
      else {
        // Part A3 owns replacement of the native exclusive claim contract. Keep
        // existing native safety overlays until that backend migration lands.
        await captureBeforeSwitch();
        if (!valid()) return;
        await withDeadline(
          claimNativeWorkspace(session.session_id, request.deviceId),
          nativeCommandMs,
        );
      }
      if (!valid()) return;
      const latest = await withDeadline(readNativeSync(), nativeCommandMs);
      if (
        valid() &&
        latest?.session_id === session.session_id &&
        latest.account_id === session.account_id
      )
        useBrowserSyncStore.setState({ session: latest });
    } catch {
      if (valid()) {
        setPending(null);
        setError("Could not update this device. Check its connection and try the action again.");
      }
    } finally {
      requesting.current = false;
    }
  };
  return (
    <div>
      <ul className="divide-y divide-charcoal-border">
        {rows.map((device) => {
          const online = device.connection === "Connected";
          const connection = online
            ? "Online"
            : device.connection === "Offline"
              ? "Offline"
              : "Connection unknown";
          const opened = onWorkspace(session) === device.device_id;
          const reason = !online
            ? "Connect this device to open its tabs."
            : !device.full_sync || session.full_sync === false
              ? "Enable Full sync on both devices to open tabs here."
              : !session.sync
                ? "Update Misty on both devices before opening this workspace's tabs here."
                : null;
          const busy = pending?.deviceId === device.device_id;
          const open =
            !device.local &&
            (opened ? (
              <span className="text-xs text-cream-muted">Open here</span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                aria-label={`Open tabs from ${device.name} here`}
                title={reason ?? undefined}
                disabled={!!pending || !!reason}
                onClick={() => void change({ deviceId: device.device_id })}
              >
                {busy && pending?.mode === undefined && pending?.name === undefined
                  ? "Opening…"
                  : compact
                    ? "Open tabs here"
                    : "Open its tabs here"}
              </Button>
            ));
          return (
            <li key={device.device_id} className={compact ? "py-3" : "py-1"}>
              <div
                className={
                  compact
                    ? "flex items-center justify-between gap-3"
                    : "flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                }
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-cream">
                    <span
                      aria-hidden
                      className={`size-1.5 shrink-0 rounded-full ${online ? "bg-cream" : "bg-cream-muted"}`}
                    />
                    <span className="break-words">{device.name}</span>
                    {!compact && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!pending || !online}
                        aria-label={`Rename ${device.name}`}
                        onClick={() =>
                          setEditing(editing === device.device_id ? null : device.device_id)
                        }
                      >
                        {editing === device.device_id ? "Cancel" : "Rename"}
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-cream-muted">
                    {connection}
                    {device.local ? " · This device" : ""}
                  </p>
                </div>
                {open}
              </div>
              {!compact && (
                <>
                  {editing === device.device_id && (
                    <Row label={`Name for ${device.name}`}>
                      <TextControl
                        value={device.display_name}
                        placeholder={device.name}
                        disabled={!!pending}
                        onCommit={(name) => {
                          if (name.trim() && name.trim() !== device.display_name)
                            void change({ deviceId: device.device_id, name: name.trim() });
                        }}
                      />
                    </Row>
                  )}
                  <Row
                    label={`Full sync for ${device.name}`}
                    description={
                      !device.control_version
                        ? "Update this device to change its sync mode."
                        : device.full_sync
                          ? "Share this device’s tabs and website sign-ins."
                          : "Independent workspace. Tabs and website sign-ins stay here; account settings still sync."
                    }
                    last
                  >
                    <SwitchControl
                      checked={device.full_sync}
                      disabled={!!pending || !online || device.control_version < 1}
                      onChange={(mode) => void change({ deviceId: device.device_id, mode })}
                    />
                  </Row>
                  {!device.local && reason && (
                    <p className="px-5 pb-3 text-xs text-cream-muted">{reason}</p>
                  )}
                </>
              )}
              {busy && (
                <p role="status" className="px-5 py-2 text-xs text-cream-muted">
                  Waiting for the device to confirm…
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="px-5 py-3 text-sm text-cream">
          {error}
        </p>
      )}
    </div>
  );
}
