import { useEffect, useRef } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { AuthProvider } from "../auth/AuthContext";
import { RenderErrorBoundary } from "@/shared/components/RenderErrorBoundary";
import { useSetupStore } from "../stores/useSetupStore";
import { installMistyDeepLinkHandler } from "../routing/deepLinks";
import { useAppZoom } from "@/shared/hooks/useAppZoom";
import { isNativeMobileBuild } from "@/platform/buildTarget";

export function RootLayout(props: {
  isDeepLinkRouteAllowed: (route: string) => boolean;
  resolveAuthDeepLinkRoute: (target: "account" | "providers") => string;
}) {
  const navigate = useNavigate();
  const appZoom = useAppZoom();
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
    if (setupLoadStarted.current) return;
    setupLoadStarted.current = true;
    void loadSystem();
  }, [loadSystem]);

  return (
    <>
      <AuthProvider>
        <RenderErrorBoundary>
          <Outlet />
        </RenderErrorBoundary>
      </AuthProvider>
      <AppZoomIndicator visible={appZoom.indicatorVisible} percent={appZoom.zoomPercent} />
    </>
  );
}

function AppZoomIndicator(props: { visible: boolean; percent: number }) {
  return (
    <div
      className={`pointer-events-none fixed left-1/2 top-[calc(var(--misty-window-titlebar-inset)+12px)] z-[2147483000] -translate-x-1/2 rounded-full border border-border bg-popover px-3 py-1.5 text-sm font-semibold text-popover-foreground shadow-xl transition duration-150 ${props.visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"}`}
      role="status"
      aria-live="polite"
      aria-hidden={!props.visible}
    >
      {props.percent}%
    </div>
  );
}
