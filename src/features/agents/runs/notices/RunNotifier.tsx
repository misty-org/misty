import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { resolveSetting, useDevicePreferences } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { runtimeAiApi } from "../../AgentsRuntime";
import { localDocuments } from "../../conversations/state/localChats";
import { useMistyStore } from "../../conversations/state/useMistyStore";
import { useAgentAccountId } from "../../personal/agentAccount";
import { usePersonalAgentsStore } from "../../personal/personalAgentsStore";
import { watchAllRunEvents } from "../local-run/localRunEvents";
import { RunNoticeTracker, noticeRoute, noticeTitle, type RunNotice } from "./runNotices";

export const RUN_NOTICES_SETTING = "agents.run_notifications";
const openEvent = "misty://agent-run-notice-open";

function noticesOn(): boolean {
  const state = useDevicePreferences.getState().state;
  // Before this computer's settings are read, the default holds.
  return state ? Boolean(resolveSetting(state, RUN_NOTICES_SETTING).value) : true;
}

function agentName(agentId: string): string {
  const agents = usePersonalAgentsStore.getState().agents;
  const agent =
    agents.find((item) => item.id === agentId) ??
    (agentId ? undefined : agents.find((item) => item.system_managed));
  return agent?.name ?? "";
}

/** The chat's title, and nothing else from it. */
async function chatTitle(accountId: string, conversationId: string): Promise<string> {
  const known = useMistyStore
    .getState()
    .conversations.find((chat) => chat.id === conversationId)?.title;
  if (known?.trim()) return known.trim();
  try {
    const document = await localDocuments.get(accountId, "conversation", conversationId);
    const title = document ? (JSON.parse(document) as { title?: unknown }).title : undefined;
    return typeof title === "string" ? title.trim() : "";
  } catch {
    return "";
  }
}

async function send(accountId: string, notice: RunNotice) {
  await invoke("agent_run_notify", {
    runId: notice.runId,
    kind: notice.kind,
    title: noticeTitle(agentName(notice.agentId), notice.kind),
    body: await chatTitle(accountId, notice.conversationId),
    route: noticeRoute(notice.agentId, notice.conversationId),
  });
}

/**
 * Tells the person through the system when a chat's run finishes, fails or waits on them while
 * Misty isn't in front. Rendered once in each person's window; native code shows one notice for
 * all of them, and only when none is focused. Clicking it opens the chat here.
 */
export function RunNotifier() {
  const accountId = useAgentAccountId();
  const navigate = useNavigate();

  useEffect(() => {
    if (!hasTauriInternals()) return;
    const unlisten = getCurrentWebview().listen<{ route?: string }>(openEvent, ({ payload }) => {
      if (typeof payload.route === "string" && payload.route.startsWith("/agents?"))
        void navigate(payload.route);
    });
    return () => void unlisten.then((stop) => stop());
  }, [navigate]);

  useEffect(() => {
    if (!hasTauriInternals() || !accountId) return;
    let live = true;
    let timer: number | undefined;
    const tracker = new RunNoticeTracker();
    const refresh = () =>
      // Before the agents' services are mounted there is nothing to ask yet.
      void Promise.resolve()
        .then(() => runtimeAiApi.activity(""))
        .then((result) => {
          if (!live) return;
          const notices = tracker.update(result.entries);
          if (!notices.length || !noticesOn()) return;
          for (const notice of notices) void send(accountId, notice).catch(() => undefined);
        })
        .catch(() => undefined);
    refresh();
    const stop = watchAllRunEvents((runId, event) => {
      tracker.noteEvent(runId, event);
      // One run streaming never holds back another's ending.
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        refresh();
      }, 500);
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
      stop();
    };
  }, [accountId]);

  return null;
}
