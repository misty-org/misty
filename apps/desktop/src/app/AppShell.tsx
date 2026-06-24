import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { DesktopAppShell } from "./DesktopAppShell";
import { MobileAppShell } from "./MobileAppShell";
import { WelcomeOnboarding } from "../features/onboarding/WelcomeOnboarding";
import { useSetupStore } from "../features/hub/store/useSetupStore";
import type { CurrentLicense, CurrentUser } from "../features/hub/types/setup";
import { installMistyDeepLinkHandler } from "./deepLinks";
import { detectAppFormFactor, subscribeAppFormFactor, type AppFormFactor } from "./platform";

export function AppShell() {
  const navigate = useNavigate();
  const [formFactor, setFormFactor] = useState<AppFormFactor>(() => detectAppFormFactor());
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
      <WelcomeOnboarding
        formFactor={formFactor}
        checkingAccount={!status && !systemError}
        onSignedIn={handleSignedIn}
      />
    );
  }

  return formFactor === "mobile" ? <MobileAppShell /> : <DesktopAppShell />;
}
