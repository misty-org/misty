import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { DesktopAppShell } from "./DesktopAppShell";
import { MobileAppShell } from "./MobileAppShell";
import { WelcomeOnboarding } from "../onboarding/WelcomeOnboarding";
import { useSetupStore } from "../stores/useSetupStore";
import type { CurrentLicense, CurrentUser } from "../models/setup";
import { installMistyDeepLinkHandler } from "./deepLinks";
import { detectAppFormFactor, subscribeAppFormFactor, type AppFormFactor } from "./platform";
import { useAppZoom } from "./useAppZoom";

export function AppShell() {
  const navigate = useNavigate();
  const [formFactor, setFormFactor] = useState<AppFormFactor>(() => detectAppFormFactor());
  const appZoom = useAppZoom();
  const setupLoadStarted = useRef(false);
  const {
    status,
    systemError,
    loadSystem,
    saveAuthenticatedUser,
  } = useSetupStore(useShallow((state) => ({
    status: state.status,
    systemError: state.systemError,
    loadSystem: state.loadSystem,
    saveAuthenticatedUser: state.saveAuthenticatedUser,
  })));

  useEffect(() => subscribeAppFormFactor(setFormFactor), []);

  useEffect(() => installMistyDeepLinkHandler(formFactor, navigate), [formFactor, navigate]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.formFactor = formFactor;
  }, [formFactor]);

  useEffect(() => {
    if (setupLoadStarted.current) return;
    setupLoadStarted.current = true;
    void loadSystem();
  }, [loadSystem]);

  async function handleSignedIn(user: CurrentUser, license: CurrentLicense | null) {
    await saveAuthenticatedUser(user, license);
  }

  if (!status?.current_user) {
    return (
      <>
        <WelcomeOnboarding
          formFactor={formFactor}
          checkingAccount={!status && !systemError}
          onSignedIn={handleSignedIn}
        />
        <AppZoomIndicator visible={appZoom.indicatorVisible} percent={appZoom.zoomPercent} />
      </>
    );
  }

  return (
    <>
      {formFactor === "mobile" ? <MobileAppShell /> : <DesktopAppShell />}
      <AppZoomIndicator visible={appZoom.indicatorVisible} percent={appZoom.zoomPercent} />
    </>
  );
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
  
