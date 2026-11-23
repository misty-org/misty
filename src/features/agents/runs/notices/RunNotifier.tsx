import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { resolveSetting, useDevicePreferences } from "@/features/settings";
import { useDoNotDisturb } from "@/shared/lib/do_not_disturb";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { runtimeAiApi } from "../../agents_runtime";
import { localDocuments } from "../../conversations/state/local_chats";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import { useAgentAccountId } from "../../personal/agent_account";
import { usePersonalAgentsStore } from "../../personal/personal_agents_store";
import { watchAllRunEvents } from "../local-run/local_run_events";
import { RunNoticeTracker, noticeRoute, noticeTitle, type RunNotice } from "./run_notices";

const RUN_NOTICES_SETTING = "agents.run_notifications";
const openEvent = "misty://agent-run-notice-open";

function noticesOn(): boolean {
  const state = useDevicePreferences.getState().state;
  if (useDoNotDisturb.getState().value) return false;
  return state ? Boolean(resolveSetting(state, RUN_NOTICES_SETTING).value) : true;
}

function agentName(agentId: string): string {
  const agents = usePersonalAgentsStore.getState().agents;
  const agent =
    agents.find((item) => item.id === agentId) ??
    (agentId ? undefined : agents.find((item) => item.system_managed));
  return agent?.name ?? "";
}

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

export function RunNotifier() {
  const accountId = useAgentAccountId();
  const navigate = useNavigate();

  useEffect(() => {
    if (!hasTauriInternals()) return;
    const unlisten = getCurrentWebview().listen<{ route?: string }>(openEvent, ({ payload }) => {
      if (
        typeof payload.route === "string" &&
        ["/agents?", "/spaces/", "/dms/"].some((prefix) => payload.route!.startsWith(prefix))
      )
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
