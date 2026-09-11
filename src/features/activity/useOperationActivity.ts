import { useEffect } from "react";
import { operationQueueSnapshot } from "@/native/transfers-tools";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { createOperationActivityObserver } from "./operationActivity";
import { readDeploymentScope } from "@/api/deployment/api";

export function useOperationActivity(accountId: string) {
  useEffect(() => {
    if (!accountId || !hasTauriInternals() || isNativeMobileBuild) return;
    let active = true,
      pending = false;
    const deployment = readDeploymentScope();
    const observe = createOperationActivityObserver();
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const snapshot = await operationQueueSnapshot();
        if (active && readDeploymentScope() === deployment) observe(snapshot, accountId);
      } catch {
        /* A failed poll is not a failed job. Keep the last known state. */
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [accountId]);
}
