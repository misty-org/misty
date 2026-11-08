import { invoke } from "@tauri-apps/api/core";
import { deviceModelCall } from "@/api/runtime/device-models";
import type { GlobalAiConversation } from "../../conversations/state/conversationTypes";
import {
  executionGeneration,
  finishLocalExecution,
  pauseLocalExecution,
  useLocalExecution,
  type Execution,
} from "./localExecutionState";

export async function steerLocalExecution(prompt: string) {
  const { useMistyStore } = await import("@/features/agents/conversations/state/useMistyStore");
  const before = useMistyStore.getState();
  const execution = useLocalExecution.getState().execution;
  const method = execution?.method;
  const conversationId = execution?.conversationId ?? before.activeConversationId;
  await pauseLocalExecution();
  const { replaceActiveGlobalInvocationStream } =
    await import("@/features/agents/conversations/state/mistyStoreUpdates");
  replaceActiveGlobalInvocationStream();
  useMistyStore.setState({
    working: false,
    activeConversationId: conversationId,
    selectedSpaceId: useLocalExecution.getState().execution?.spaceId ?? before.selectedSpaceId,
  });
  if (method) {
    throw new Error(
      "This workflow stopped at takeover. Review its completed and uncertain results, " +
        "then explicitly start a new run. Automatic workflow resume is not available.",
    );
  } else if (
    useLocalExecution.getState().execution?.normalTabs ||
    useLocalExecution.getState().execution?.desktopControl
  ) {
    const companion = (await import("../../cursor/companionState")).useCompanionState.getState();
    if (!companion.submit || companion.accountId !== before.accountId)
      throw new Error(
        "Fresh desktop context is unavailable in this window. Open the main Misty window and ask there. The task remains paused.",
      );
    await companion.submit({ prompt, conversationId });
  } else if (useLocalExecution.getState().execution?.autopilot) {
    await useMistyStore.getState().submitAnswer(prompt, undefined, undefined, "workspace");
  } else {
    await useMistyStore.getState().submitAnswer(prompt);
  }
}

export async function routeLocalFollowup(prompt: string): Promise<string> {
  const { useMistyStore } = await import("@/features/agents/conversations/state/useMistyStore");
  const execution = useLocalExecution.getState().execution;
  const conversationId = useMistyStore.getState().activeConversationId;
  if (!execution || !conversationId) throw new Error("Open the active task conversation first.");
  await pauseLocalExecution(execution.taskId);
  if (execution.method)
    throw new Error(
      "This workflow is stopped. Review its results and explicitly start a new run; automatic workflow resume is not available.",
    );
  const routingGeneration = executionGeneration();
  // The device's fast model decides; the chat's last turns give it the task's context.
  const { route } = await deviceModelCall<{ route: "steer" | "queue" | "stop" }>("follow-up", {
    conversation: recentTurns(useMistyStore.getState().conversations, conversationId),
    new_message: prompt,
  });
  if (
    executionGeneration() !== routingGeneration ||
    useLocalExecution.getState().execution?.taskId !== execution.taskId ||
    useMistyStore.getState().accountId !== execution.accountId
  )
    throw new Error("The active task changed. The follow-up was not applied.");
  if (route === "stop") return "Stopped. Completed changes have not been undone.";
  if (route === "queue") {
    await enqueueForegroundTask(execution, prompt);
    await steerLocalExecution(
      "Continue the current task, preserving all earlier constraints. Inspect the current state before repeating any write.",
    );
    return "Independent request queued after this task.";
  }
  await steerLocalExecution(prompt);
  return "Follow-up applied to this task.";
}

const clip = (text: string) => [...text].slice(0, 3000).join("");

/** The chat's last six request and reply pairs, oldest first. */
function recentTurns(conversations: GlobalAiConversation[] | undefined, conversationId: string) {
  const messages = conversations?.find((item) => item.id === conversationId)?.messages ?? [];
  const turns: { request: string; response: string }[] = [];
  for (const message of messages) {
    if (message.role === "user") turns.push({ request: clip(message.content), response: "" });
    else if (turns.length) turns[turns.length - 1].response = clip(message.content);
  }
  return turns.slice(-6);
}

const enqueueForegroundTask = ({ accountId, agentId, spaceId }: Execution, prompt: string) =>
  invoke("agent_foreground_queue", { task: { accountId, agentId, spaceId, prompt } });
/** Queues an independent request after the current task, which keeps running. */
export async function queueLocalFollowup(prompt: string) {
  const execution = useLocalExecution.getState().execution;
  if (!execution || execution.method)
    throw new Error("This task can't take new requests. Start a new task after it finishes.");
  await enqueueForegroundTask(execution, prompt);
}

let drainingQueue = false;
export async function continueQueuedLocalWork(expectedTaskId: string) {
  if (drainingQueue) return;
  drainingQueue = true;
  try {
    const { useMistyStore } = await import("@/features/agents/conversations/state/useMistyStore");
    const execution = useLocalExecution.getState().execution;
    if (
      execution?.taskId !== expectedTaskId ||
      execution.state !== "finished" ||
      useMistyStore.getState().working
    )
      return;
    const task = await invoke<{
      queueId: string;
      accountId: string;
      agentId: string;
      spaceId: string;
      prompt: string;
    } | null>("agent_foreground_queue", {});
    if (!task || useLocalExecution.getState().execution?.taskId !== expectedTaskId) return;
    if (task.accountId !== useMistyStore.getState().accountId) return;
    await finishLocalExecution();
    useMistyStore.setState({
      selectedAgentId: task.agentId,
      selectedSpaceId: task.spaceId,
      executionMode: "agent",
      activeConversationId: "",
      context: [],
      handoff: { spaceId: task.spaceId, context: [] },
    });
    await useMistyStore.getState().submitAnswer(task.prompt);
    if (useMistyStore.getState().invocationId)
      await invoke("agent_foreground_queue", { acknowledgeId: task.queueId });
  } finally {
    drainingQueue = false;
  }
}
