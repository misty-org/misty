import { runtimeAiApi } from "@/features/agents/AgentsRuntime";
import type { GlobalAiConversation } from "../conversations/state/conversationTypes";
import {
  followReply as follow,
  isFollowingRun,
  latestReply as laneReply,
} from "../conversations/state/backgroundReplies";
import { newLocalConversation } from "../conversations/state/localConversation";
import {
  conversationMessage,
  patchConversationMessage,
  settleConversationMessage,
} from "../conversations/state/mistyStoreUpdates";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { errorText, type Multirun, type MultirunLane } from "./multirunApi";
import { laneTitle } from "./multirunLogic";

/**
 * A multi-run's lanes are ordinary chats, one per agent, so each has its transcript, its
 * approvals and its follow-ups like any other. Their runs are followed in the background, several
 * at once, each into its own chat's reply (`backgroundReplies.ts`).
 */

const set = useMistyStore.setState;
const get = useMistyStore.getState;

/** Chats whose run is being started. */
const starting = new Set<string>();

/** A lane's reply: the last thing its agent said in the lane's chat. */
export { laneReply };

/** One new chat per agent, holding the task and an empty reply. Not shown until `showLaneChats`. */
export function draftLaneChats(task: string, agentIds: readonly string[]): GlobalAiConversation[] {
  return agentIds.map((agentId) => ({
    ...newLocalConversation(laneTitle(task) || "Multi-run", undefined, agentId),
    messages: [
      conversationMessage("user", "ask", task),
      conversationMessage("assistant", "ask", ""),
    ],
  }));
}

/** Adds the lanes' chats to the person's chats, leaving the open chat as it is. */
export function showLaneChats(chats: GlobalAiConversation[]) {
  for (const chat of chats) starting.add(chat.id);
  set({ conversations: [...chats, ...get().conversations] });
}

/** Starts a lane's agent on the task, in the lane's worktree, and follows it into its chat. */
export async function startLane(run: Multirun, lane: MultirunLane) {
  const reply = laneReply(get().conversations, lane.conversationId);
  if (!reply) return;
  try {
    const created = await runtimeAiApi.createInvocation({
      mode: "drawer",
      surfaceId: "global",
      trigger: "message",
      prompt: run.task,
      context: [],
      agentId: lane.agentId,
      conversationId: lane.conversationId,
      executionMode: "user",
      deviceContexts: [],
      idempotencyKey: `multirun:${run.id}:${lane.index}`,
    });
    patchConversationMessage(set, get, lane.conversationId, reply.id, {
      invocationId: created.invocationId,
    });
    follow(lane.conversationId, reply.id, created.invocationId);
  } catch (error) {
    settleConversationMessage(set, get, lane.conversationId, reply.id, {
      state: "failed",
      content: errorText(error),
      retryable: false,
    });
  } finally {
    starting.delete(lane.conversationId);
  }
}

/**
 * Picks up lanes whose reply still reads as unfinished and that nothing follows: after the
 * window reloads, or Misty restarts. A run that ended meanwhile is settled; one still going is
 * followed again from its first event.
 */
export async function resumeLanes(runs: readonly Multirun[]) {
  for (const lane of runs.flatMap((run) => run.lanes)) {
    const reply = laneReply(get().conversations, lane.conversationId);
    if (!reply || starting.has(lane.conversationId)) continue;
    if (reply.state !== "pending" && reply.state !== "streaming") continue;
    const runId = reply.invocationId;
    const settle = (ending: Parameters<typeof settleConversationMessage>[4]) =>
      settleConversationMessage(set, get, lane.conversationId, reply.id, {
        retryable: false,
        ...ending,
      });
    if (!runId) {
      settle({ state: "failed", content: "This run never started." });
      continue;
    }
    // The chat store may have picked this one up itself as the window loaded.
    if (isFollowingRun(runId) || get().invocationId === runId) continue;
    const { state } = await runtimeAiApi.invocationState(runId).catch(() => ({ state: "" }));
    if (state === "completed") settle({ state: "completed" });
    else if (state === "canceled") settle({ state: "canceled" });
    else if (state === "failed" || state === "missing")
      settle({
        state: "failed",
        content: reply.content || "Misty closed before this run finished.",
      });
    else if (state) {
      // Its events replay from the start, so the reply is filled again from empty.
      patchConversationMessage(set, get, lane.conversationId, reply.id, {
        content: "",
        progress: undefined,
      });
      follow(lane.conversationId, reply.id, runId);
    }
  }
}

/** Stops a lane's run, if it is still going. */
export async function stopLane(lane: MultirunLane) {
  const reply = laneReply(get().conversations, lane.conversationId);
  if (!reply?.invocationId || (reply.state !== "pending" && reply.state !== "streaming")) return;
  await runtimeAiApi.cancelInvocation(reply.invocationId).catch(() => undefined);
}
