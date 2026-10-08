import { getCurrentWindow } from "@tauri-apps/api/window";
import { readAccountAuthToken } from "@/features/auth";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useEffect } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import { DesktopAgentJobWorker } from "./worker";
import { endAllHostedSessions } from "./hostedSessions";
import { watchLocalExecutionForKeepAwake } from "./keepAwake";
import { useLocalExecution } from "./localExecution";
import { isSpaceWindowLabel, spaceWindow } from "@/features/workspace/spaceWindow";

export function AgentJobWorker() {
  const { user } = useAuth();

  useEffect(() => {
    if (!hasTauriInternals() || !isSpaceWindowLabel(getCurrentWindow().label) || !spaceWindow().personal || !user?.id) return;
    let canceled = false;
    let worker: DesktopAgentJobWorker | null = null;
    void readAccountAuthToken().then((token) => {
      if (canceled || !token) return;
      worker = new DesktopAgentJobWorker();
      worker.start(user.id);
      // Old project switches become remembered approvals, once.
      void import("./coding/projectMigration")
        .then(({ migrateProjectSwitches }) => migrateProjectSwitches())
        .catch(() => undefined);
    });
    // This computer stays awake while its own agent task runs.
    const unwatch = watchLocalExecutionForKeepAwake((listener) => {
      const running = (state: ReturnType<typeof useLocalExecution.getState>) =>
        state.execution?.state === "running" || state.execution?.state === "waiting";
      listener(running(useLocalExecution.getState()));
      return useLocalExecution.subscribe((state) => listener(running(state)));
    });
    return () => {
      canceled = true;
      worker?.stop();
      unwatch();
      // Sessions for other devices end with this account here.
      void endAllHostedSessions();
    };
  }, [user?.id]);
  // Sessions it hosts show in the control island.
  return null;
}
