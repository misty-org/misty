import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import "./App.css";
import { HubShell } from "./components/HubShell";
import { useSetupStore } from "./store/useSetupStore";

export function HubWorkspace() {
  const loadSystem = useSetupStore((state) => state.loadSystem);
  const refreshLocalAccessToken = useSetupStore(
    (state) => state.refreshLocalAccessToken,
  );

  useEffect(() => {
    void loadSystem();
  }, [loadSystem]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshLocalAccessToken();
    }, 10 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [refreshLocalAccessToken]);

  return (
    <AuthProvider>
      <HubShell>
        <Outlet />
      </HubShell>
    </AuthProvider>
  );
}
