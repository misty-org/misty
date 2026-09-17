import { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AuthProvider, useAuth } from "@/features/auth";
import { useDocumentAppAppearance } from "@/features/settings";
import { useAppsStore } from "@/features/apps/useAppsStore";
import { useSpacesStore } from "@/features/spaces";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { GlobalMistySurface } from "@/features/global-search/GlobalMisty";
import type { MistyImageAttachment } from "@/features/global-search/types";
import { BrowserContextMenuBridge } from "@/features/global-search/BrowserContextMenuBridge";
import { AgentExecutionSurface } from "./AgentExecutionSurface";
import {
  agentWorkerParameters,
  pauseLocalExecution,
  routeLocalFollowup,
  useLocalExecution,
} from "./localExecution";
import { usePersonalAgentsStore } from "./personalAgentsStore";

export interface AgentWindowTask {
  queueId: string;
  conversationId?: string;
  accountId: string;
  agentId: string;
  spaceId: string;
  prompt: string;
  attachments: MistyImageAttachment[];
}
export function AgentWorkerRoot() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Worker />
      </AuthProvider>
    </BrowserRouter>
  );
}
function Worker() {
  useDocumentAppAppearance();
  const { user } = useAuth();
  const [error, setError] = useState("");
  const expectedAccount = agentWorkerParameters.get("agent_account") ?? "";
  const agentId = agentWorkerParameters.get("agent_worker") ?? "";
  useEffect(() => {
    if (!user?.id) return;
    if (user.id !== expectedAccount) {
      setError("This worker's account is no longer active. Its task is paused.");
      void pauseLocalExecution();
      return;
    }
    let disposed = false,
      busy = false,
      failed = false;
    const take = async () => {
      if (disposed || failed || busy || useLocalExecution.getState().execution?.state === "paused")
        return;
      busy = true;
      try {
        const active = useMistyStore.getState().working;
        const task = await invoke<AgentWindowTask | null>(
          "agent_window_take_task",
          active ? { conversationId: useMistyStore.getState().activeConversationId } : {},
        );
        if (!task || disposed) return;
        if (task.accountId !== user.id || task.agentId !== agentId)
          throw new Error("The queued task belongs to a different agent or account.");
        if (active) {
          if (
            task.spaceId !== useLocalExecution.getState().execution?.spaceId ||
            task.attachments.length
          )
            return;
          const message = await routeLocalFollowup(task.prompt);
          await invoke("agent_window_ack_task", { queueId: task.queueId });
          setError(message);
          return;
        }
        await useAppsStore.getState().load(user.id, false, task.spaceId);
        await useSpacesStore.getState().load({ accountId: user.id });
        await usePersonalAgentsStore.getState().load(user.id);
        if (disposed) return;
        useMistyStore.getState().setAccount(user.id);
        useMistyStore.setState({
          selectedAgentId: agentId,
          selectedSpaceId: task.spaceId,
          executionMode: "team",
          activeConversationId: "",
          handoff: { spaceId: task.spaceId, context: [] },
          panel: "answer",
        });
        if (task.conversationId) {
          await useMistyStore.getState().loadConversations();
          const conversation = useMistyStore
            .getState()
            .conversations.find(
              (c) =>
                c.id === task.conversationId && c.agentId === agentId && c.spaceId === task.spaceId,
            );
          if (conversation) useMistyStore.getState().selectConversation(conversation.id);
          else if (task.attachments.length)
            throw new Error("The attachment conversation is unavailable to this agent.");
          else useMistyStore.setState({ activeConversationId: "" });
        }
        await useMistyStore.getState().submitAnswer(task.prompt, task.attachments);
        if (!useMistyStore.getState().invocationId)
          throw new Error(
            useMistyStore.getState().error || "The queued task could not start. Retry when ready.",
          );
        await invoke("agent_window_ack_task", { queueId: task.queueId });
        setError("");
      } catch (e) {
        if (!disposed) {
          failed = true;
          setError(String(e));
        }
      } finally {
        busy = false;
      }
    };
    void take();
    const timer = setInterval(() => void take(), 1500);
    const remove = getCurrentWindow().listen("misty://agent-task-queued", () => {
      failed = false;
      void take();
    });
    return () => {
      disposed = true;
      clearInterval(timer);
      void remove.then((fn) => fn());
      void pauseLocalExecution();
    };
  }, [user?.id, expectedAccount, agentId]);
  return (
    <main className="h-dvh bg-charcoal-bg p-6 text-cream">
      <h1 className="text-lg font-medium">Agent workspace</h1>
      <p role="status" className="mt-3 text-sm text-cream-muted">
        {error ||
          "Tasks queued for this agent appear here. Close this window to pause active work."}
      </p>
      <AgentExecutionSurface />
      <BrowserContextMenuBridge />
      {user?.id === expectedAccount && (
        <GlobalMistySurface
          controller="misty"
          accountId={user.id}
          currentPath="/apps/agents"
          activePaneId="agent-worker"
          activePanePath="/apps/agents"
          includeCurrentContext={false}
          allowCapture={false}
          suspendBrowserWebviews={false}
        />
      )}
    </main>
  );
}
