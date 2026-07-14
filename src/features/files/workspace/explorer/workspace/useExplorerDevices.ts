import { devicesSnapshot } from "@/features/files/workspace/native";
import type { MountedDevice } from "@/native/contracts";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { devicesChangedEvent, emptyMountedDevices } from "./ExplorerWorkspaceConstants";
import { mountedDevicesEqual } from "./ExplorerWorkspaceUtils";
export function useExplorerDevices() {
  const deviceRefreshInFlightRef = useRef(false);
  const deviceRefreshMountedRef = useRef(true);
  const [mountedDevices, setMountedDevices] = useState<MountedDevice[]>(emptyMountedDevices);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const refreshDevices = useCallback(async (options?: { showLoading?: boolean }) => {
    if (deviceRefreshInFlightRef.current) return;
    const showLoading = options?.showLoading ?? true;
    deviceRefreshInFlightRef.current = true;
    if (showLoading && deviceRefreshMountedRef.current) setDevicesLoading(true);
    try {
      const snapshot = await devicesSnapshot();
      if (deviceRefreshMountedRef.current) {
        setMountedDevices((current) =>
          mountedDevicesEqual(current, snapshot.devices) ? current : snapshot.devices,
        );
      }
    } catch {
      if (deviceRefreshMountedRef.current) {
        setMountedDevices((current) => (current.length === 0 ? current : emptyMountedDevices));
      }
    } finally {
      deviceRefreshInFlightRef.current = false;
      if (showLoading && deviceRefreshMountedRef.current) setDevicesLoading(false);
    }
  }, []);
  useEffect(() => {
    deviceRefreshMountedRef.current = true;
    void refreshDevices();
    const refreshOnFocus = () => void refreshDevices();
    window.addEventListener("focus", refreshOnFocus);
    let active = true;
    let unlisten: UnlistenFn | null = null;
    const eventRefreshTimers = new Set<number>();
    const refreshFromDeviceEvent = () => {
      void refreshDevices({
        showLoading: false,
      });
      const timer = window.setTimeout(() => {
        eventRefreshTimers.delete(timer);
        void refreshDevices({
          showLoading: false,
        });
      }, 1200);
      eventRefreshTimers.add(timer);
    };
    void (async () => {
      try {
        if (!hasTauriInternals()) return;
        const stopListening = await listen(devicesChangedEvent, refreshFromDeviceEvent);
        if (active) {
          unlisten = stopListening;
        } else {
          void stopListening();
        }
      } catch {}
    })();
    return () => {
      active = false;
      deviceRefreshMountedRef.current = false;
      window.removeEventListener("focus", refreshOnFocus);
      eventRefreshTimers.forEach((timer) => window.clearTimeout(timer));
      if (unlisten) void unlisten();
    };
  }, [refreshDevices]);
  return {
    devicesLoading,
    mountedDevices,
    refreshDevices,
  };
}
