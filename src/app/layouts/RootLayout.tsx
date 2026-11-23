import { cn, Surface, Text } from "@misty/ui";
import { RenderErrorBoundary } from "@/app/layouts/RenderErrorBoundary";
import { AuthProvider, useAuth } from "@/features/account";
import { useNativeSessionStore } from "@/features/account";
import { DevicePreferencesBridge } from "@/features/account";
import { useDocumentAppAppearance } from "@/features/settings";
import { useShortcutHandler } from "@/features/shortcuts";
import { ShortcutRuntime } from "../ShortcutRuntime";
import { PetRuntime } from "@/features/pets";
import { RunNotifier } from "@/features/agents";
import { TrayVisibility } from "@/features/app-windows";
import { useAppZoom } from "@/shared/hooks/use_app_zoom";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { platform as osPlatform } from "@/shared/platform/os";
import { useEffect, useRef } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { installMistyDeepLinkHandler } from "../routing/deep_links";
export function RootLayout(props: {
  isDeepLinkRouteAllowed: (route: string) => boolean;
  resolveAuthDeepLinkRoute: () => string;
}) {
  const navigate = useNavigate();
  const appZoom = useAppZoom();
  useShortcutHandler("app.zoom_in", appZoom.zoomIn);
  useShortcutHandler("app.zoom_out", appZoom.zoomOut);
  useShortcutHandler("app.zoom_reset", appZoom.resetZoom);
  useDocumentAppAppearance();
  const setupLoadStarted = useRef(false);
  const { loadSystem } = useNativeSessionStore(
    useShallow((state) => ({
      loadSystem: state.loadSystem,
    })),
  );
  useEffect(
    () =>
      installMistyDeepLinkHandler(
        navigate,
        props.isDeepLinkRouteAllowed,
        props.resolveAuthDeepLinkRoute,
      ),
    [navigate, props.isDeepLinkRouteAllowed, props.resolveAuthDeepLinkRoute],
  );
  useEffect(() => {
    if (!hasTauriInternals()) return;
    try {
      document.documentElement.dataset.osPlatform = osPlatform();
    } catch {}
  }, []);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    if (setupLoadStarted.current) return;
    setupLoadStarted.current = true;
    void loadSystem();
  }, [loadSystem]);
  return (
    <>
      <AuthProvider>
        <DevicePreferencesBridge />
        <ShortcutRuntime />
        <PetRuntime />
        <RunNotifier />
        <TrayVisibility />
        <RenderErrorBoundary>
          <AuthenticatedTreeOutlet />
        </RenderErrorBoundary>
      </AuthProvider>
      <AppZoomIndicator visible={appZoom.indicatorVisible} percent={appZoom.zoomPercent} />
    </>
  );
}
function AuthenticatedTreeOutlet() {
  const { outletKey } = useAuth();
  return <Outlet key={outletKey} />;
}
function AppZoomIndicator(props: { visible: boolean; percent: number }) {
  return (
    <Surface
      tone="card"
      edge="hairline"
      radius="lg"
      className={cn(
        "pointer-events-none fixed inset-x-0 top-10 layer-dialog-backdrop mx-auto w-fit",
        "px-3 py-1.5 transition duration-150",
        props.visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
      )}
      role="status"
      aria-live="polite"
      aria-hidden={!props.visible}
    >
      <Text bare size="control" weight="semibold" tone="default">
        {props.percent}%
      </Text>
    </Surface>
  );
}
