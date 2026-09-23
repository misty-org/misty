import { getCurrentWindow } from "@tauri-apps/api/window";
import { readAccountAuthToken } from "@/features/auth";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useEffect } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import { DesktopAgentJobWorker } from "./worker";

export function AgentJobWorker(): null {
  const { user } = useAuth();

  useEffect(() => {
    if (!hasTauriInternals() || getCurrentWindow().label !== "main" || !user?.id) return;
    let canceled = false;
    let worker: DesktopAgentJobWorker | null = null;
    void readAccountAuthToken().then((token) => {
      if (canceled || !token) return;
      worker = new DesktopAgentJobWorker();
      worker.start(user.id);
    });
    return () => {
      canceled = true;
      worker?.stop();
    };
  }, [user?.id]);
  return null;
}
