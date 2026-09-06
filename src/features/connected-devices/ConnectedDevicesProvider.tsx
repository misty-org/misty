import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useConnectedDevices as useConnectedDevicesController } from "./useConnectedDevices";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace/core";
import type { OpenWorkspaceRouteRequest } from "@/native/contracts";
import { listen } from "@tauri-apps/api/event";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useNavigate } from "react-router-dom";

type ConnectedDevicesController = ReturnType<typeof useConnectedDevicesController>;

const ConnectedDevicesContext = createContext<ConnectedDevicesController | null>(null);

export function ConnectedDevicesProvider({ children }: PropsWithChildren) {
  const controller = useConnectedDevicesController();
  const navigate = useNavigate();
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!hasTauriInternals() || isNativeMobileBuild) return;
    let unlisten: (() => void) | undefined;
    let active = true;
    void listen<OpenWorkspaceRouteRequest>("misty://open-workspace-route", ({ payload }) => {
      const surface = workspaceSurfaceFromRoute(payload.route);
      if (!surface || surface.surfaceId !== payload.surface) return;
      useWorkspaceStore.getState().openSurface(surface);
      navigate(payload.route);
      setNotice(`Opened from ${payload.sourceDeviceName}`);
      window.setTimeout(() => setNotice(""), 5000);
    }).then((dispose) => {
      if (active) unlisten = dispose;
      else dispose();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [navigate]);

  const value = useMemo(() => controller, [controller]);
  return (
    <ConnectedDevicesContext.Provider value={value}>
      {children}
      {notice ? (
        <div
          className="fixed bottom-5 right-5 z-[2147483200] rounded-lg border border-charcoal-border bg-charcoal-active px-4 py-3 text-sm text-cream-bright shadow-xl"
          role="status"
        >
          {notice}
        </div>
      ) : null}
    </ConnectedDevicesContext.Provider>
  );
}

export function useConnectedDevices(): ConnectedDevicesController {
  const value = useContext(ConnectedDevicesContext);
  if (!value) throw new Error("useConnectedDevices must be used inside ConnectedDevicesProvider.");
  return value;
}
