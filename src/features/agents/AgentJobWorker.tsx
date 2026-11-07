import { hasTauriInternals } from "@/shared/platform/tauri";
import { useEffect, useState } from "react";
import { useAgentAccountId } from "./agentAccount";
import { DeviceEmbeddingWorker } from "./deviceEmbeddings";
import { endAllHostedSessions } from "./hostedSessions";
import { startLocalToolHost } from "./localTools/host";
import { startLocalRunWork } from "./localTools";
import { watchLocalExecutionForKeepAwake } from "./keepAwake";
import { useLocalExecution } from "./localExecution";
import { isHostWindow, onHostWindow } from "@/features/workspace/profileWindow";

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

/** The work this computer owes its agents, in the one window that hosts it. An account isn't needed. */
export function AgentJobWorker() {
  const accountId = useAgentAccountId();
  const host = useHostWindow();

  useEffect(() => {
    if (!hasTauriInternals() || !host) return;
    const stopRunWork = startLocalRunWork();
    // The vectors memory ranks by are made here too.
    const embeddings = new DeviceEmbeddingWorker();
    embeddings.start();
    // This computer stays awake while its own agent task runs.
    const unwatch = watchLocalExecutionForKeepAwake((listener) => {
      const running = (state: ReturnType<typeof useLocalExecution.getState>) =>
        state.execution?.state === "running" || state.execution?.state === "waiting";
      listener(running(useLocalExecution.getState()));
      return useLocalExecution.subscribe((state) => listener(running(state)));
    });
    return () => {
      embeddings.stop();
      stopRunWork();
      unwatch();
      // The agent's own sessions end with this account here.
      void endAllHostedSessions();
    };
  }, [host, accountId]);
  // Once per page, whatever the account does: restarting this would abandon the calls it's running,
  // and the account reads as signed out for a moment on every load.
  useEffect(() => {
    if (!hasTauriInternals() || !host) return;
    return startLocalToolHost();
  }, [host]);
  // Sessions it hosts show in the control island.
  return null;
}
