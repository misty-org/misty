import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef } from "react";
import { invoke } from "@/native/invoke";
import { desktopOs } from "@/shared/platform/desktopOs";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { useChatStatuses } from "../page/useChatStatuses";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";

/** A chat the menu bar panel lists: its agent is working, or waiting on the person. */
export interface TrayChat {
  id: string;
  agentId: string;
  title: string;
  agentName: string;
  status: "working" | "needs-you";
}

/** The panel lists this many at most, the newest first. */
const MOST_CHATS = 6;

/**
 * Keeps the menu bar panel (`src-tauri/features/app/tray_panel.rs`) listing the chats whose agents
 * are working or waiting on the person, and opens one here when the person picks it there. Only
 * macOS has the panel. Mounted once per main window.
 */
export function useTrayAgents(onOpenChat: (agentId: string, chatId: string) => void): void {
  const statuses = useChatStatuses();
  const conversations = useMistyStore((state) => state.conversations);
  const agents = usePersonalAgentsStore((state) => state.agents);
  const open = useRef(onOpenChat);
  open.current = onOpenChat;
  // Only the macOS app has the panel; anywhere else (a test, a preview) there is no window to
  // listen on.
  const available = hasTauriInternals() && desktopOs() === "macos";

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
    const remove = getCurrentWindow().listen<TrayChat>("misty://tray-open-chat", ({ payload }) =>
      open.current(payload.agentId, payload.id),
    );
    return () => void remove.then((stop) => stop());
  }, [available]);
}

/** `useTrayAgents` as a component, for a layout that has no hook of its own to hold it. */
export function TrayAgentsSync(props: { onOpenChat(agentId: string, chatId: string): void }): null {
  useTrayAgents(props.onOpenChat);
  return null;
}
