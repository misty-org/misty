import { hasTauriInternals } from "@/shared/platform/tauri";
import { useEffect, useState } from "react";
import { useAgentAccountId } from "../../personal/agent_account";
import { endAllHostedSessions } from "../hosted-sessions/hosted_sessions";
import { startLocalToolHost } from "../../tools/host";
import { startLocalRunWork } from "../../tools";
import { watchLocalExecutionForKeepAwake } from "./keep_awake";
import { useLocalExecution } from "../local-execution/local_execution_state";
import { isHostWindow, onHostWindow } from "@/features/app-windows";
import { useAgentTrashReminder } from "../../settings/agent_trash_reminder";

function useHostWindow() {
  const [host, setHost] = useState(false);
  useEffect(() => {
    let active = true;
    void isHostWindow().then((value) => active && setHost(value));
    const stop = onHostWindow(() => void isHostWindow().then((value) => active && setHost(value)));
    return () => {
      active = false;
      stop();
    };
  }, []);
  return host;
}

export function AgentJobWorker() {
  const accountId = useAgentAccountId();
  const host = useHostWindow();

  useEffect(() => {
    if (!hasTauriInternals() || !host) return;
    const stopRunWork = startLocalRunWork();
    const unwatch = watchLocalExecutionForKeepAwake((listener) => {
      const running = (state: ReturnType<typeof useLocalExecution.getState>) =>
        state.execution?.state === "running" || state.execution?.state === "waiting";
      listener(running(useLocalExecution.getState()));
      return useLocalExecution.subscribe((state) => listener(running(state)));
    });
    return () => {
      stopRunWork();
      unwatch();
      void endAllHostedSessions();
    };
  }, [host, accountId]);
  useEffect(() => {
    if (!hasTauriInternals() || !host) return;
    return startLocalToolHost();
  }, [host]);
  useAgentTrashReminder(host);
  return null;
}
