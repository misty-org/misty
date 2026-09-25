import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Monitor } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import {
  activateNativeDevice,
  controlNativeDevice,
  readNativeSync,
  type NativeSyncView,
} from "./native";
import { useBrowserSyncStore } from "./store";
import { deviceRows, formatRate, transferRate } from "./deviceControl";

type Pending = { deviceId: string; fullSync: boolean | null; started: number };
export function DeviceControlContent({ session }: { session: NativeSyncView }) {
  const [rates, setRates] = useState<{ up: number | null; down: number | null }>({
    up: null,
    down: null,
  });
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const requesting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let reading = false;
    let sample: { uploaded: number; downloaded: number; at: number } | null = null;
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
        const at = performance.now();
        if (latest.traffic) {
          setRates({
            up: transferRate(
              sample && { bytes: sample.uploaded, at: sample.at },
              latest.traffic.uploaded_bytes,
              at,
            ),
            down: transferRate(
              sample && { bytes: sample.downloaded, at: sample.at },
              latest.traffic.downloaded_bytes,
              at,
            ),
          });
          sample = {
            uploaded: latest.traffic.uploaded_bytes,
            downloaded: latest.traffic.downloaded_bytes,
            at,
          };
        }
        setError((current) => (current === "Could not refresh device status." ? null : current));
        useBrowserSyncStore.setState({ session: latest });
      } catch {
        if (valid()) {
          setRates({ up: null, down: null });
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
        ? session.workspace.active_device?.device_id === pending.deviceId
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
        setError("The device did not confirm the change. Check its connection and try again.");
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
      if (fullSync === null && deviceId === session.device_id)
        await activateNativeDevice(session.session_id);
      else await controlNativeDevice(session.session_id, deviceId, fullSync, fullSync === null);
    } catch (failure) {
      if (mounted.current && generation === readApiSessionGeneration()) {
        setPending(null);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      requesting.current = false;
    }
  };
  return (
    <section aria-label="Device controls" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Devices</h2>
        <p className="mt-1 text-xs text-cream-muted">
          Choose where you work and which devices follow along.
        </p>
      </div>
      <ul className="max-h-64 space-y-3 overflow-y-auto">
        {deviceRows(session).map((device) => (
          <li key={device.device_id} className="border-t border-charcoal-border pt-3">
            <div className="flex items-center gap-2">
              <Monitor className="size-4 shrink-0 text-cream-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" title={device.name}>
                  {device.name}
                </div>
                <div className="text-xs text-cream-muted">
                  {device.connection}
                  {device.active ? " · Active" : ""}
                </div>
              </div>
              {!device.active && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    Boolean(pending) ||
                    device.connection !== "Connected" ||
                    !device.full_sync ||
                    (!device.local && device.control_version < 1)
                  }
                  onClick={() => void change(device.device_id, null)}
                  aria-label={`Switch to ${device.name}`}
                >
                  {pending?.deviceId === device.device_id && pending.fullSync === null
                    ? "Switching…"
                    : device.local
                      ? "Use here"
                      : "Switch"}
                </Button>
              )}
            </div>
            <label className="mt-2 flex items-center justify-between gap-3 pl-6 text-xs">
              <span>Full sync</span>
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
            </label>
            {pending?.deviceId === device.device_id && pending.fullSync !== null && (
              <p role="status" aria-live="polite" className="mt-1 pl-6 text-xs text-cream-muted">
                Turning Full sync {pending.fullSync ? "on" : "off"}…
              </p>
            )}
            {device.control_version < 1 && (
              <p className="mt-1 pl-6 text-xs text-cream-muted">
                Update the server and this device to enable sync controls.
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-cream-muted">
        Full sync off keeps a device’s workspace independent and connected. Turning it on joins the
        shared workspace.
      </p>
      <div className="border-t border-charcoal-border pt-3">
        <h3 className="text-xs font-medium">Sync traffic · this device</h3>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-sm tabular-nums">
          <div>
            <dt className="flex items-center gap-1 text-xs text-cream-muted">
              <ArrowUp className="size-3" aria-hidden />
              Upload
            </dt>
            <dd>{formatRate(rates.up)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-xs text-cream-muted">
              <ArrowDown className="size-3" aria-hidden />
              Download
            </dt>
            <dd>{formatRate(rates.down)}</dd>
          </div>
        </dl>
        <p className="mt-1 text-xs text-cream-muted">
          Live sync payloads, excluding website traffic and connection overhead.
        </p>
      </div>
      {error && (
        <p role="alert" className="break-words text-xs text-avatar-red">
          {error}
        </p>
      )}
    </section>
  );
}
