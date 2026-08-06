import { useEffect, useRef } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { AuthProvider } from "@/features/auth/AuthContext";
import { PointerDragProvider } from "@/features/dnd/PointerDragContext";
import { RenderErrorBoundary } from "@/layouts/RenderErrorBoundary";
import { useSetupStore } from "@/stores/app";
import { installMistyDeepLinkHandler } from "../routing/deepLinks";
import { useAppZoom } from "@/hooks/useAppZoom";
import { useDocumentAppAppearance } from "@/hooks/useDocumentAppAppearance";
import { isNativeMobileBuild } from "@/platform/buildTarget";
import { hasTauriInternals } from "@/platform/tauri";

export function RootLayout(props: {
  isDeepLinkRouteAllowed: (route: string) => boolean;
  resolveAuthDeepLinkRoute: (target: "account" | "providers") => string;
}) {
  const navigate = useNavigate();
  const appZoom = useAppZoom();
  useDocumentAppAppearance();
  const setupLoadStarted = useRef(false);
  const { loadSystem } = useSetupStore(
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
    document.documentElement.dataset.formFactor = isNativeMobileBuild ? "mobile" : "desktop";
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    try {
      document.documentElement.dataset.osPlatform = osPlatform();
    } catch {
      // Platform detection is best-effort; leave the attribute unset.
    }
  }, []);

  useEffect(() => {
    if (setupLoadStarted.current) return;
    setupLoadStarted.current = true;
    void loadSystem();
  }, [loadSystem]);

  return (
    <>
      <AuthProvider>
        <RenderErrorBoundary>
          <PointerDragProvider>
            <Outlet />
          </PointerDragProvider>
        </RenderErrorBoundary>
      </AuthProvider>
      <AppZoomIndicator visible={appZoom.indicatorVisible} percent={appZoom.zoomPercent} />
    </>
  );
}

function AppZoomIndicator(props: { visible: boolean; percent: number }) {
  return (
    <div
      className={`pointer-events-none fixed left-1/2 top-10 z-[2147483000] -translate-x-1/2 rounded-full border border-charcoal-border bg-charcoal-card px-3 py-1.5 text-sm font-semibold text-cream shadow-xl transition duration-150 ${props.visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"}`}
      role="status"
      aria-live="polite"
      aria-hidden={!props.visible}
    >
      {props.percent}%
    </div>
  );
}
