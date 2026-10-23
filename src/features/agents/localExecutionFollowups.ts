import { invoke } from "@tauri-apps/api/core";
import { apiRequest } from "@/api/client";
import {
  executionGeneration,
  finishLocalExecution,
  pauseLocalExecution,
  useLocalExecution,
  type Execution,
} from "./localExecutionState";

export async function steerLocalExecution(prompt: string) {
  const { useMistyStore } = await import("@/features/misty/useMistyStore");
  const before = useMistyStore.getState();
  const execution = useLocalExecution.getState().execution;
  const method = execution?.method;
  const conversationId = execution?.conversationId ?? before.activeConversationId;
  await pauseLocalExecution();
  const { replaceActiveGlobalInvocationStream } =
    await import("@/features/misty/mistyStoreHelpers");
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
    const companion = (await import("./companion/companionState")).useCompanionState.getState();
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
  const { useMistyStore } = await import("@/features/misty/useMistyStore");
  const execution = useLocalExecution.getState().execution;
  const conversationId = useMistyStore.getState().activeConversationId;
  if (!execution || !conversationId) throw new Error("Open the active task conversation first.");
  await pauseLocalExecution(execution.taskId);
  if (execution.method)
    throw new Error(
      "This workflow is stopped. Review its results and explicitly start a new run; automatic workflow resume is not available.",
    );
  const routingGeneration = executionGeneration();
  const { route } = await apiRequest<{ route: "steer" | "queue" | "stop" }>(
    "/misty/agent-followup",
    {
      method: "POST",
      body: JSON.stringify({
        agent_id: execution.agentId,
        conversation_id: conversationId,
        prompt,
      }),
    },
  );
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
    const { useMistyStore } = await import("@/features/misty/useMistyStore");
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
