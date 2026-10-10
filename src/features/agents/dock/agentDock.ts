import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { create } from "zustand";
import {
  browserRuntimeIdForTabId,
  requestBrowserWebviewLayoutByRuntimeId,
} from "@/features/webviews/browserRuntime";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { isAgentWorkerWindow, type Execution } from "../localExecution";

/**
 * The dock (docs/design/agents-at-cursor/BRIEF.md, "Taking over the app"): an
 * agent's own window, or the tab an agent works in after Detach, shrinks into a
 * corner and keeps working there, on screen. This window's part of it: whether
 * this agent window is docked, and the window holding this task's tab when the
 * agent was detached from here.
 */
export const useAgentDock = create<{
  docked: boolean;
  host: { id: string; tab: string } | null;
}>(() => ({ docked: false, host: null }));

interface DockEvent {
  action?: string;
  id?: string;
}

export const dockAvailable = () => hasTauriInternals() && /Mac/.test(navigator.platform);

/** Detach works on a task that runs in one of the person's own tabs here. */
export function canDetach(execution: Execution | null) {
  return Boolean(
    dockAvailable() &&
    execution?.normalTabs &&
    !isAgentWorkerWindow() &&
    (execution.state === "running" || execution.state === "waiting") &&
    execution.context.some((ref) => ref.kind === "browser-tab"),
  );
}

/** Moves the task's tab, live, into its own docked window. The task keeps running here. */
export async function detachTask(execution: Execution, agentName: string) {
  const ref = execution.context.find((item) => item.kind === "browser-tab");
  const tab = ref ? browserRuntimeIdForTabId(ref.id) : null;
  if (!ref || !tab) throw new Error("This task's tab is no longer open.");
  const id = await invoke<string>("agent_tab_detach", {
    tab,
    title: ref.title || "Agent tab",
    name: agentName,
  });
  useAgentDock.setState({ host: { id, tab } });
}

/** Brings the detached tab back to its place in this window. */
export async function attachTask() {
  const host = useAgentDock.getState().host;
  if (!host) return;
  await invoke("agent_tab_attach", { host: host.id });
  returned(host.tab);
}

function returned(tab: string) {
  useAgentDock.setState({ host: null });
  requestBrowserWebviewLayoutByRuntimeId(tab);
}

export async function dockThisWindow(agentName: string) {
  await invoke("agent_dock_window", { name: agentName });
}

export async function showDockedTask() {
  const host = useAgentDock.getState().host;
  await invoke("agent_dock_open", host ? { id: host.id } : {});
}

/**
 * Keeps the dock in step with this window's task: its label shows the island's
 * status, Stop in the dock stops the task, and the tab comes home when the task
 * ends.
 */
export function useAgentDockSync(
  execution: Execution | null,
  status: string,
  waiting: boolean,
  onStop: () => void,
) {
  const host = useAgentDock((state) => state.host);
  const stop = useRef(onStop);
  stop.current = onStop;

  useEffect(() => {
    if (!dockAvailable()) return;
    const own = getCurrentWindow().label;
    const remove = getCurrentWindow().listen<DockEvent>("misty://agent-dock", ({ payload }) => {
      const away = useAgentDock.getState().host;
      if (payload.id === own) {
        if (payload.action === "docked") useAgentDock.setState({ docked: true });
        else if (payload.action === "opened") useAgentDock.setState({ docked: false });
        else if (payload.action === "stop") stop.current();
      } else if (away && payload.id === away.id) {
        if (payload.action === "stop") stop.current();
        else if (payload.action === "attached") returned(away.tab);
      }
    });
    return () => void remove.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    if (!dockAvailable() || (!host && !isAgentWorkerWindow())) return;
    void invoke("agent_dock_status", {
      ...(host ? { id: host.id } : {}),
      status,
      waiting,
    }).catch(() => undefined);
  }, [host, status, waiting]);

  // A finished or stopped task gives the tab back, so its result is where the person works.
  const ended = !execution || execution.state === "finished";
  useEffect(() => {
    if (host && ended) void attachTask().catch(() => undefined);
  }, [host, ended]);
}
