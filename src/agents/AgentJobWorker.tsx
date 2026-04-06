import { useEffect } from "react";
import { hasTauriInternals } from "@/shared/tauri";
import { useAuth } from "../auth/AuthContext";
import { readAccountAuthToken } from "../pages/Account/shared/authTokenStore";
import { DesktopAgentJobWorker } from "./worker";

export function AgentJobWorker(): null {
  const { user } = useAuth();

  useEffect(() => {
    if (!hasTauriInternals() || !user?.id) return;
    let canceled = false;
    let worker: DesktopAgentJobWorker | null = null;
    void readAccountAuthToken().then((token) => {
      if (canceled || !token) return;
      worker = new DesktopAgentJobWorker();
      worker.start();
    });
    return () => {
      canceled = true;
      worker?.stop();
    };
  }, [user?.id]);
  return null;
}
