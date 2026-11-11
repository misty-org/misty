import { runtimeAiApi, subscribeAgentsInvocation } from "@/features/agents/AgentsRuntime";
import type {
  GlobalAiConversation,
  GlobalAiMessage,
} from "../conversations/state/conversationTypes";
import { newLocalConversation } from "../conversations/state/localConversation";
import {
  applyGlobalInvocationEvent,
  conversationMessage,
  flushStreamedText,
  patchConversationMessage,
  settleConversationMessage,
} from "../conversations/state/mistyStoreUpdates";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { followAddress } from "../runs/local-run/localRunParts";
import { errorText, type Multirun, type MultirunLane } from "./multirunApi";
import { laneTitle } from "./multirunLogic";

/**
 * A multi-run's lanes are ordinary chats, one per agent, so each has its transcript, its
 * approvals and its follow-ups like any other. The chat store follows one run at a time, so the
 * lanes are followed here instead: several at once, each into its own chat's reply.
 */

const set = useMistyStore.setState;
const get = useMistyStore.getState;

/** Runs being followed, by run id, and chats whose run is being started. */
const following = new Set<string>();
const starting = new Set<string>();

/** A lane's reply: the last thing its agent said in the lane's chat. */
export function laneReply(
  conversations: readonly GlobalAiConversation[],
  conversationId: string,
): GlobalAiMessage | undefined {
  const chat = conversations.find((item) => item.id === conversationId);
  const replies = chat?.messages.filter((message) => message.role === "assistant");
  return replies?.[replies.length - 1];
}

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

type Ending = Partial<GlobalAiMessage> & { state: "completed" | "failed" | "canceled" };

function follow(conversationId: string, messageId: string, runId: string) {
  if (following.has(runId)) return;
  following.add(runId);
  let stop = () => {};
  let ended = false;
  const said = () => laneReply(get().conversations, conversationId)?.content ?? "";
  const end = (ending: Ending) => {
    if (ended) return;
    ended = true;
    following.delete(runId);
    flushStreamedText();
    settleConversationMessage(set, get, conversationId, messageId, { retryable: false, ...ending });
    stop();
  };
  stop = subscribeAgentsInvocation(followAddress(runId), {
    onEvent: (event) => {
      if (ended) return;
      // The chat store's own handling of an ending also ends whichever run it is following,
      // which may be another chat's, so a lane's ending is applied here.
      if (event.type === "invocation.completed") end({ state: "completed" });
      else if (event.type === "invocation.failed") end({ state: "failed", content: event.error });
      else if (event.type === "invocation.canceled")
        end({ state: "canceled", content: said() || "This run was stopped." });
      else applyGlobalInvocationEvent(set, get, conversationId, messageId, event);
    },
    onError: (error) => end({ state: "failed", content: said() || error.message }),
  });
  if (ended) stop();
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
    const settle = (ending: Ending) =>
      settleConversationMessage(set, get, lane.conversationId, reply.id, {
        retryable: false,
        ...ending,
      });
    if (!runId) {
      settle({ state: "failed", content: "This run never started." });
      continue;
    }
    // The chat store may have picked this one up itself as the window loaded.
    if (following.has(runId) || get().invocationId === runId) continue;
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
