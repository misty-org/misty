import { useEffect, useRef, useState } from "react";
import { Outlet, useNavigate, useOutletContext } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { AuthProvider } from "../auth/AuthContext";
import { RenderErrorBoundary } from "../shared/components/RenderErrorBoundary";
import { useSetupStore } from "../stores/useSetupStore";
import { installMistyDeepLinkHandler } from "../routing/deepLinks";
import {
  detectAppFormFactor,
  subscribeAppFormFactor,
  type AppFormFactor,
} from "../platform/formFactor";
import { useAppZoom } from "../shared/hooks/useAppZoom";

type RootLayoutContext = {
  formFactor: AppFormFactor;
};

export function RootLayout(props: {
  isDeepLinkRouteAllowed: (route: string, formFactor: AppFormFactor) => boolean;
  resolveAuthDeepLinkRoute: (target: "account" | "providers") => string;
}) {
  const navigate = useNavigate();
  const [formFactor, setFormFactor] = useState<AppFormFactor>(() => detectAppFormFactor());
  const appZoom = useAppZoom();
  const setupLoadStarted = useRef(false);
  const {
    loadSystem,
  } = useSetupStore(useShallow((state) => ({
    loadSystem: state.loadSystem,
  })));

  useEffect(() => subscribeAppFormFactor(setFormFactor), []);

  useEffect(
    () =>
      installMistyDeepLinkHandler(
        formFactor,
        navigate,
        props.isDeepLinkRouteAllowed,
        props.resolveAuthDeepLinkRoute,
      ),
    [
      formFactor,
      navigate,
      props.isDeepLinkRouteAllowed,
      props.resolveAuthDeepLinkRoute,
    ],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.formFactor = formFactor;
  }, [formFactor]);

  useEffect(() => {
    if (setupLoadStarted.current) return;
    setupLoadStarted.current = true;
    void loadSystem();
  }, [loadSystem]);

  return (
    <>
      <AuthProvider>
        <RenderErrorBoundary>
          <Outlet context={{ formFactor } satisfies RootLayoutContext} />
        </RenderErrorBoundary>
      </AuthProvider>
      <AppZoomIndicator visible={appZoom.indicatorVisible} percent={appZoom.zoomPercent} />
    </>
  );
}

export function useRootLayoutContext(): RootLayoutContext {
  return useOutletContext<RootLayoutContext>();
}

function AppZoomIndicator(props: { visible: boolean; percent: number }) {
  return (
    <div
      className={`pointer-events-none fixed left-1/2 top-3 z-[2147483000] -translate-x-1/2 rounded-full border border-[var(--misty-border-soft)] bg-[color-mix(in_srgb,var(--misty-bg)_88%,transparent)] px-3 py-1.5 text-sm font-semibold text-[var(--misty-text)] shadow-[0_12px_32px_var(--misty-shadow)] backdrop-blur-xl transition duration-150 ${props.visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"}`}
      role="status"
      aria-live="polite"
      aria-hidden={!props.visible}
    >
      {props.percent}%
    </div>
  );
}
  
