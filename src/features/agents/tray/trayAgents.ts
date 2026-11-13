import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef } from "react";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { useChatStatuses } from "../page/useChatStatuses";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { aiSurfaceApi } from "../runs/invocations/api";

/** A chat the menu bar menu lists: its agent is working, or waiting on the person. */
export interface TrayChat {
  id: string;
  agentId: string;
  title: string;
  agentName: string;
  status: "working" | "needs-you";
}

/** The menu lists this many at most, the newest first. */
const MOST_CHATS = 6;

/** A run's states while it works or waits on the person: what Stop All Agents stops. */
const LIVE = new Set(["running", "queued", "awaiting_approval", "awaiting_intervention"]);

/** Stops every chat's run. Stopping a run stops the sub-agents it started too. */
async function stopAllAgents() {
  const { entries } = await aiSurfaceApi.activity("");
  const runs = entries.filter((entry) => !entry.parent_run_id && LIVE.has(entry.state));
  await Promise.all(
    runs.map((entry) =>
      aiSurfaceApi.cancelInvocation(entry.run_id || entry.id).catch(() => undefined),
    ),
  );
}

interface TrayActions {
  onOpenChat(agentId: string, chatId: string): void;
  onNewChat(): void;
}

/**
 * Keeps the menu bar menu (`src-tauri/features/app/tray.rs`) listing the chats whose agents are
 * working or waiting on the person, and acts here on what the person picks there: a chat, a new
 * chat, or stopping them all. Mounted once per main window.
 */
function useTrayAgents(actions: TrayActions): void {
  const statuses = useChatStatuses();
  const conversations = useMistyStore((state) => state.conversations);
  const agents = usePersonalAgentsStore((state) => state.agents);
  const latest = useRef(actions);
  latest.current = actions;
  // Outside the desktop app (a test, a preview) there is no menu bar and no window to listen on.
  const available = hasTauriInternals();

  const chats = useMemo<TrayChat[]>(() => {
    const busy: TrayChat[] = [];
    const sorted = [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const chat of sorted) {
      const status = statuses[chat.id];
      if (status !== "working" && status !== "needs-you") continue;
      const agent =
        agents.find((item) => item.id === chat.agentId) ??
        (chat.agentId ? undefined : agents.find((item) => item.system_managed));
      if (!agent) continue;
      busy.push({
        id: chat.id,
        agentId: agent.id,
        title: chat.title,
        agentName: agent.name,
        status,
      });
      if (busy.length === MOST_CHATS) break;
    }
    return busy;
  }, [agents, conversations, statuses]);

  const key = JSON.stringify(chats);
  useEffect(() => {
    if (!available) return;
    void invoke("tray_agents", { chats: JSON.parse(key) as TrayChat[] }).catch(() => undefined);
  }, [available, key]);

  useEffect(() => {
    if (!available) return;
    const current = getCurrentWindow();
    const removes = [
      current.listen<TrayChat>("misty://tray-open-chat", ({ payload }) =>
        latest.current.onOpenChat(payload.agentId, payload.id),
      ),
      current.listen("misty://tray-new-chat", () => latest.current.onNewChat()),
      current.listen("misty://tray-stop-agents", () => void stopAllAgents().catch(() => undefined)),
    ];
    return () => removes.forEach((remove) => void remove.then((stop) => stop()));
  }, [available]);
}

/** `useTrayAgents` as a component, for a layout that has no hook of its own to hold it. */
export function TrayAgentsSync(props: TrayActions): null {
  useTrayAgents(props);
  return null;
}
