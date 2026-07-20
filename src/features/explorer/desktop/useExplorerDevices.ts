import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  AndroidAllFilesAccessStatus,
  FileEntry,
  MountedDevice,
} from "@/models/interfaces/services/misty-api";
import { isAndroidBuild } from "@/platform/buildTarget";
import { hasTauriInternals } from "@/platform/tauri";
import {
  androidAllFilesAccessStatus,
  devicesSnapshot,
  explorerListDirectory,
} from "@/stores/backend";
import { devicesChangedEvent, emptyMountedDevices } from "./ExplorerWorkspaceConstants";
import { mountedDevicesEqual } from "./ExplorerWorkspaceUtils";

export function useExplorerDevices(homePath: string) {
  const deviceRefreshInFlightRef = useRef(false);
  const deviceRefreshMountedRef = useRef(true);
  const [mountedDevices, setMountedDevices] = useState<MountedDevice[]>(emptyMountedDevices);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [androidAllFilesAccess, setAndroidAllFilesAccess] =
    useState<AndroidAllFilesAccessStatus | null>(null);
  const [androidGrantedFolders, setAndroidGrantedFolders] = useState<FileEntry[]>([]);

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

  const refreshAndroidGrantedFolders = useCallback(async (): Promise<FileEntry[]> => {
    if (!isAndroidBuild) return [];
    try {
      const listing = await explorerListDirectory({ path: homePath, showHidden: false });
      const folders = listing.entries.filter((entry) => entry.kind === "folder");
      setAndroidGrantedFolders(folders);
      return folders;
    } catch {
      setAndroidGrantedFolders([]);
      return [];
    }
  }, [homePath]);

  const refreshAndroidAllFilesAccess =
    useCallback(async (): Promise<AndroidAllFilesAccessStatus | null> => {
      if (!isAndroidBuild) return null;
      try {
        const status = await androidAllFilesAccessStatus();
        setAndroidAllFilesAccess(status);
        return status;
      } catch {
        setAndroidAllFilesAccess(null);
        return null;
      }
    }, []);

  useEffect(() => {
    if (!isAndroidBuild) return;
    void refreshAndroidAllFilesAccess();
    void refreshAndroidGrantedFolders();
    const refreshOnFocus = () => {
      void refreshAndroidAllFilesAccess();
      void refreshAndroidGrantedFolders();
    };
    const refreshOnVisibility = () => {
      if (document.visibilityState === "visible") refreshOnFocus();
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, [refreshAndroidAllFilesAccess, refreshAndroidGrantedFolders]);

  useEffect(() => {
    deviceRefreshMountedRef.current = true;
    void refreshDevices();
    const refreshOnFocus = () => void refreshDevices();
    window.addEventListener("focus", refreshOnFocus);
    let active = true;
    let unlisten: UnlistenFn | null = null;
    const eventRefreshTimers = new Set<number>();
    const refreshFromDeviceEvent = () => {
      void refreshDevices({ showLoading: false });
      const timer = window.setTimeout(() => {
        eventRefreshTimers.delete(timer);
        void refreshDevices({ showLoading: false });
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
    androidAllFilesAccess,
    androidGrantedFolders,
    devicesLoading,
    mountedDevices,
    refreshAndroidAllFilesAccess,
    refreshAndroidGrantedFolders,
    refreshDevices,
  };
}
