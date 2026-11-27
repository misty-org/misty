import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef } from "react";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { useChatStatuses } from "../page/use_chat_statuses";
import { usePersonalAgentsStore } from "../personal/personal_agents_store";
import { aiSurfaceApi } from "../runs/invocations/api";
import { notify } from "@misty/ui";

export interface TrayChat {
  id: string;
  agentId: string;
  title: string;
  agentName: string;
  status: "working" | "needs-you";
}

const MOST_CHATS = 6;

const LIVE = new Set(["running", "queued", "awaiting_approval", "awaiting_intervention"]);

async function stopAllAgents() {
  const { entries } = await aiSurfaceApi.activity("");
  const runs = entries.filter((entry) => !entry.parent_run_id && LIVE.has(entry.state));
  const stopped = await Promise.all(
    runs.map((entry) =>
      aiSurfaceApi.cancelInvocation(entry.run_id || entry.id).then(
        () => true,
        () => false,
      ),
    ),
  );
  const failed = stopped.filter((ok) => !ok).length;
  if (failed) notify({ message: "Some agents couldn't be stopped.", tone: "error" });
  else if (stopped.length)
    notify({
      message: stopped.length === 1 ? "Stopped 1 agent" : `Stopped ${stopped.length} agents`,
    });
}

interface TrayActions {
  onOpenChat(agentId: string, chatId: string): void;
  onNewChat(): void;
}

function useTrayAgents(actions: TrayActions): void {
  const statuses = useChatStatuses();
  const conversations = useMistyStore((state) => state.conversations);
  const agents = usePersonalAgentsStore((state) => state.agents);
  const latest = useRef(actions);
  latest.current = actions;
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
      current.listen(
        "misty://tray-stop-agents",
        () =>
          void stopAllAgents().catch(() =>
            notify({ message: "Couldn't stop the agents. Try again.", tone: "error" }),
          ),
      ),
    ];
    return () => removes.forEach((remove) => void remove.then((stop) => stop()));
  }, [available]);
}

export function TrayAgentsSync(props: TrayActions): null {
  useTrayAgents(props);
  return null;
}
