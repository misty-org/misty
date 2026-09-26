import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Monitor, MousePointer2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { cn } from "@/shared/ui/utils";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import {
  activateNativeDevice,
  claimNativeTree,
  controlNativeDevice,
  readNativeSync,
  type NativeSyncView,
} from "./native";
import { useBrowserSyncStore } from "./store";
import { deviceRows } from "./deviceControl";
import { useUserStore } from "@/features/auth/core";
import { TreeSwitcherList } from "./TreeSwitcherList";

type Pending = { deviceId: string; fullSync: boolean | null; started: number };
export function DeviceControlContent({
  session,
  onOpenSyncSettings,
}: {
  session: NativeSyncView;
  onOpenSyncSettings: () => void;
}) {
  const ownerName = useUserStore((state) => state.me?.name);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const requesting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let reading = false;
    const generation = readApiSessionGeneration();
    const valid = () =>
      !stopped &&
      !isApiSessionTransitioning() &&
      generation === readApiSessionGeneration() &&
      useBrowserSyncStore.getState().session?.session_id === session.session_id;
    const read = async () => {
      if (reading || !valid()) return;
      reading = true;
      try {
        const latest = await readNativeSync();
        if (
          !valid() ||
          latest?.session_id !== session.session_id ||
          latest.account_id !== session.account_id
        )
          return;
        setError((current) => (current === "Could not refresh device status." ? null : current));
        useBrowserSyncStore.setState({ session: latest });
      } catch {
        if (valid()) {
          setError("Could not refresh device status.");
        }
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 1000);
    return () => {
      stopped = true;
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [session.session_id, session.account_id]);
  useEffect(() => {
    if (!pending) return;
    const confirmed =
      pending.fullSync === null
        ? session.trees
          ? session.trees.driving_tree === pending.deviceId
          : session.workspace.active_device?.device_id === pending.deviceId
        : session.devices?.some(
            (device) =>
              device.device_id === pending.deviceId && device.full_sync === pending.fullSync,
          );
    if (confirmed) {
      setPending(null);
      return;
    }
    const timer = window.setTimeout(
      () => {
        setPending(null);
        setError("Device did not respond. Try again.");
      },
      Math.max(0, 35000 - (Date.now() - pending.started)),
    );
    return () => window.clearTimeout(timer);
  }, [pending, session]);
  const change = async (deviceId: string, fullSync: boolean | null) => {
    if (pending || requesting.current || isApiSessionTransitioning()) return;
    requesting.current = true;
    setPending({ deviceId, fullSync, started: Date.now() });
    setError(null);
    const generation = readApiSessionGeneration();
    try {
      // Tree mode: switching claims that device's workspace on this device.
      if (fullSync === null && session.trees) {
        // Save this workspace's pages before leaving it for another one.
        // Loaded on demand: capture pulls in the workspace store.
        await import("./restore/capture").then(({ captureAll }) => captureAll(true));
        await claimNativeTree(session.session_id, deviceId);
      } else if (fullSync === null && deviceId === session.device_id)
        await activateNativeDevice(session.session_id);
      else await controlNativeDevice(session.session_id, deviceId, fullSync, fullSync === null);
    } catch {
      if (mounted.current && generation === readApiSessionGeneration()) {
        setPending(null);
        setError("Could not update device. Try again.");
      }
    } finally {
      requesting.current = false;
    }
  };
  return (
    <section aria-label="Device controls">
      <div className="flex items-center justify-between gap-3 pb-2 text-sm">
        <h2 className="font-semibold">Devices</h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto w-14 p-0 text-cream-muted hover:underline"
          aria-label="Sync settings"
          onClick={onOpenSyncSettings}
        >
          Sync
        </Button>
      </div>
      {session.trees ? (
        <TreeSwitcherList
          session={session}
          trees={session.trees}
          pending={pending}
          onSwitch={(deviceId) => void change(deviceId, null)}
          onFullSync={(deviceId, enabled) => void change(deviceId, enabled)}
        />
      ) : (
        <ul className="divide-y divide-charcoal-border">
          {deviceRows(session, ownerName).map((device) => (
            <li key={device.device_id} className="group/device py-3">
              <div className="flex items-center gap-3">
                <Monitor className="size-4 shrink-0 text-cream-muted" aria-hidden />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate font-medium" title={device.name}>
                    {device.name}
                  </div>
                  <div className="text-cream-muted">{device.connection}</div>
                </div>
                {device.active ? (
                  <span
                    role="img"
                    aria-label={`Active device: ${device.name}`}
                    title="Active device"
                    className="flex size-8 shrink-0 items-center justify-center text-cream"
                  >
                    <Check aria-hidden className="size-4" />
                  </span>
                ) : (
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center",
                      !(pending?.deviceId === device.device_id && pending.fullSync === null) &&
                        "pointer-events-none opacity-0 group-hover/device:pointer-events-auto group-hover/device:opacity-100 group-focus-within/device:pointer-events-auto group-focus-within/device:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
                    )}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      className="size-8 shrink-0 p-0"
                      disabled={
                        Boolean(pending) ||
                        device.connection !== "Connected" ||
                        !device.full_sync ||
                        (!device.local && device.control_version < 1)
                      }
                      onClick={() => void change(device.device_id, null)}
                      aria-label={`Switch to ${device.name}`}
                      title={`Switch to ${device.name}`}
                      aria-busy={
                        pending?.deviceId === device.device_id && pending.fullSync === null
                      }
                    >
                      {pending?.deviceId === device.device_id && pending.fullSync === null ? (
                        <>
                          <LoaderCircle
                            aria-hidden
                            className="size-4 animate-spin motion-reduce:animate-none"
                          />
                          <span className="sr-only">Switching…</span>
                        </>
                      ) : (
                        <MousePointer2 aria-hidden className="size-4" />
                      )}
                    </Button>
                  </span>
                )}
                <span
                  className="flex w-14 shrink-0 justify-center"
                  title={
                    device.control_version < 1
                      ? "Update this device and server to enable sync controls"
                      : undefined
                  }
                >
                  <Switch
                    checked={device.full_sync}
                    disabled={
                      Boolean(pending) ||
                      device.connection !== "Connected" ||
                      device.control_version < 1
                    }
                    aria-label={`Full sync for ${device.name}`}
                    onCheckedChange={(checked) => void change(device.device_id, checked)}
                  />
                </span>
              </div>
              {pending?.deviceId === device.device_id && pending.fullSync !== null && (
                <p role="status" aria-live="polite" className="mt-2 pl-7 text-sm text-cream-muted">
                  Turning Full sync {pending.fullSync ? "on" : "off"}…
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 break-words text-sm text-avatar-red">
          {error}
        </p>
      )}
    </section>
  );
}
