import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { aiSurfaceApi } from "@/features/ai-surface/api";
import { dockAvailable } from "./dock/agentDock";
import { sessions, update } from "./hostedSessionsState";

/**
 * A hosted session's first tab is the agent's window (docs/design/agents-at-cursor/BRIEF.md,
 * "The docked window"): it detaches into a window of its own that docks in the corner, so
 * every agent working on this computer joins the stack and its carousel, and WebKit keeps
 * painting it. Its other tabs stay parked in this window. Without the dock (or if detaching
 * fails) the tab stays parked here, out of sight but still rendering.
 */
export async function dockHostedTab(viewId: string, name: string): Promise<string | undefined> {
  if (!dockAvailable()) return undefined;
  try {
    return await invoke<string>("agent_tab_detach", { tab: viewId, title: "Agent tab", name });
  } catch {
    return undefined;
  }
}

/** Takes a session's tab back from its docked window before the tab closes. */
export async function undockHostedTab(host: string | undefined) {
  if (host) await invoke("agent_tab_attach", { host }).catch(() => undefined);
}

interface DockEvent {
  action?: string;
  id?: string;
}

/**
 * Presses in a hosted session's docked window: Stop stops its request (which ends the
 * session), and a tab brought back is parked again, rendering, since a hidden page stops.
 */
export function listenHostedDock(): () => void {
  if (!dockAvailable()) return () => undefined;
  const remove = getCurrentWindow().listen<DockEvent>("misty://agent-dock", ({ payload }) => {
    const session = sessions().find((item) => item.host && item.host === payload.id);
    if (!session) return;
    if (payload.action === "stop") {
      void aiSurfaceApi.cancelInvocation(session.runId).catch(() => undefined);
    } else if (payload.action === "attached") {
      update(sessions().map((item) => (item === session ? { ...item, host: undefined } : item)));
      void invoke("browser_webview_hide", { request: { id: session.viewId, keepLive: true } }).catch(() => undefined);
    }
  });
  return () => void remove.then((unlisten) => unlisten());
}
