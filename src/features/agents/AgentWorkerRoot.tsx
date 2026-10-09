import { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { emitTo } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AuthProvider, useAuth } from "@/features/auth";
import { useDocumentAppAppearance } from "@/features/settings";
import { useMistyStore } from "@/features/misty/useMistyStore";
import type { AiCaptureAttachment, AiSelectionSnapshot } from "@/features/ai-surface/types";
import type { GlobalAiContextRef, MistyImageAttachment } from "@/features/global-search/types";
import { BrowserContextMenuBridge } from "@/features/global-search/BrowserContextMenuBridge";
import { AgentExecutionSurface } from "./AgentExecutionSurface";
import { agentWorkerParameters, pauseLocalExecution, useLocalExecution } from "./localExecution";
import { usePersonalAgentsStore } from "./personalAgentsStore";

export interface AgentWindowTask {
  queueId: string;
  companion?: Parameters<ReturnType<typeof useMistyStore.getState>["submitAnswer"]>[6];
  context?: GlobalAiContextRef[];
  capture?: AiCaptureAttachment;
  selection?: AiSelectionSnapshot;
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
    let currentQueue = "";
    let lastAdmission:
      | { queueId: string; result: { invocationId: string; eventsUrl: string; taskId?: string } }
      | undefined;
    const take = async () => {
      if (
        disposed ||
        failed ||
        busy ||
        (useLocalExecution.getState().execution?.state === "paused" &&
          useMistyStore.getState().working)
      )
        return;
      busy = true;
      let task: AgentWindowTask | null = null;
      try {
        const active = useMistyStore.getState().working;
        task = await invoke<AgentWindowTask | null>(
          "agent_window_take_task",
          active ? { conversationId: useMistyStore.getState().activeConversationId } : {},
        );
        if (!task || disposed) return;
        if (task.accountId !== user.id || task.agentId !== agentId)
          throw new Error("The queued task belongs to a different agent or account.");
        if (lastAdmission?.queueId === task.queueId) {
          await invoke("agent_window_ack_task", lastAdmission);
          return;
        }
        if (active) return; // Independent work waits; steering uses the server's durable inbox.
        currentQueue = task.queueId;
        lastAdmission = undefined;
        const assertCurrent = () => {
          if (disposed || currentQueue !== task?.queueId) throw new Error("Task stopped.");
        };
        await usePersonalAgentsStore.getState().load(user.id);
        assertCurrent();
        if (disposed) return;
        useMistyStore.getState().setAccount(user.id);
        useMistyStore.setState({
          selectedAgentId: agentId,
          selectedSpaceId: "",
          executionMode: "team",
          activeConversationId: "",
          panel: "answer",
        });
        if (task.conversationId) {
          const requestedConversationId = task.conversationId;
          await useMistyStore.getState().loadConversations();
          const conversation = useMistyStore
            .getState()
            .conversations.find((c) => c.id === requestedConversationId && c.agentId === agentId);
          if (conversation) useMistyStore.getState().selectConversation(conversation.id);
          else
            throw new Error(
              "The conversation is unavailable to this agent. Reopen it and try again.",
            );
        }
        assertCurrent();
        if (useMistyStore.getState().working) {
          setError(
            "Reconnected to existing work. This request remains queued until that work finishes.",
          );
          return;
        }
        // Selecting a conversation clears old handoffs; attach this task afterward.
        useMistyStore.setState({
          handoff: {
            spaceId: "",
            context: task.context ?? [],
            capture: task.capture,
            selection: task.selection,
          },
        });
        await useMistyStore.getState().submitAnswer(
          task.prompt,
          task.attachments,
          task.selection,
          "panel",
          [],
          { conversationId: task.conversationId ?? "", context: task.context ?? [] },
          {
            ...task.companion,
            executionMode: "team",
            turn: undefined,
            capture: task.capture,
            idempotencyKey: task.companion?.idempotencyKey ?? task.queueId,
          },
        );
        assertCurrent();
        if (!useMistyStore.getState().invocationId)
          throw new Error(
            useMistyStore.getState().error || "The queued task could not start. Retry when ready.",
          );
        const invocationId = useMistyStore.getState().invocationId!;
        lastAdmission = {
          queueId: task.queueId,
          result: {
            invocationId,
            eventsUrl: `/ai/invocations/${encodeURIComponent(invocationId)}/events`,
            taskId: useLocalExecution.getState().execution?.taskId,
          },
        };
        await invoke("agent_window_ack_task", lastAdmission);
        setError("");
      } catch (e) {
        if (!disposed) {
          failed = true;
          setError(String(e));
          if (task && !lastAdmission)
            await invoke("agent_window_ack_task", {
              queueId: task.queueId,
              result: { error: String(e).slice(0, 2000) },
            }).catch(() => {});
        }
      } finally {
        busy = false;
      }
    };
    // Queued tasks announce themselves; the slow pass recovers a missed event
    // or a failed acknowledgement.
    const timer = setInterval(() => void take(), 30_000);
    const stop = getCurrentWindow().listen<string>("misty://agent-task-stop", ({ payload }) => {
      if (payload !== currentQueue) return;
      currentQueue = "";
      void useMistyStore.getState().cancelResponse?.();
    });
    const unsubscribe = useMistyStore.subscribe((state, previous) => {
      if (
        !busy &&
        state.invocationId &&
        state.invocationId !== previous.invocationId &&
        state.accountId === expectedAccount &&
        state.selectedAgentId === agentId &&
        state.invocationConversationId === state.activeConversationId
      ) {
        void emitTo("main", "misty://agent-task-admitted", {
          accountId: expectedAccount,
          agentId,
          conversationId: state.activeConversationId,
          invocationId: state.invocationId,
        }).catch(() => {});
      }
      if (previous.working && !state.working) queueMicrotask(() => void take());
    });
    const remove = getCurrentWindow().listen("misty://agent-task-queued", () => {
      failed = false;
      void take();
    });
    void Promise.all([stop, remove]).then(() => {
      if (!disposed) void take();
    });
    return () => {
      disposed = true;
      clearInterval(timer);
      unsubscribe();
      void stop.then((fn) => fn());
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
    </main>
  );
}
