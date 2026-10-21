import { readAccountAuthToken } from "@/features/auth";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import { DesktopAgentJobWorker } from "./worker";
import { endAllHostedSessions } from "./hostedSessions";
import { watchLocalExecutionForKeepAwake } from "./keepAwake";
import { useLocalExecution } from "./localExecution";
import { isHostWindow, onHostWindow } from "@/features/workspace/spaceWindow";

/** Whether this window runs the device's agent jobs: the oldest open window does, and the
 * next one takes over when it closes. */
function useHostWindow() {
  const [host, setHost] = useState(false);
  useEffect(() => {
    let active = true;
    void isHostWindow().then((value) => active && setHost(value));
    // The hand-off event reaches every window, so each asks whether it is the host now; taking
    // it on the event alone started a worker in every window, agent windows too, and a job one
    // of them claimed was lost when that window closed.
    const stop = onHostWindow(() => void isHostWindow().then((value) => active && setHost(value)));
    return () => {
      active = false;
      stop();
    };
  }, []);
  return host;
}

export function AgentJobWorker() {
  const { user } = useAuth();
  const host = useHostWindow();

  useEffect(() => {
    if (!hasTauriInternals() || !host || !user?.id) return;
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
      // The agent's own sessions end with this account here.
      void endAllHostedSessions();
    };
  }, [host, user?.id]);
  // Sessions it hosts show in the control island.
  return null;
}
