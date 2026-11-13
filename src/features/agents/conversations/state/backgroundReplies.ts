import { subscribeAgentsInvocation } from "@/features/agents/AgentsRuntime";
import { followAddress } from "../../runs/local-run/localRunParts";
import type { GlobalAiConversation, GlobalAiMessage } from "./conversationTypes";
import {
  applyGlobalInvocationEvent,
  flushStreamedText,
  settleConversationMessage,
} from "./mistyStoreUpdates";
import { useMistyStore } from "./useMistyStore";

/**
 * Replies followed outside the open chat. The chat store follows one run at a time, the one in
 * the chat on screen; a multi-run's lanes and what is asked in the studio run in other chats at
 * the same time, so each of those is followed here, into its own chat's reply.
 */

const set = useMistyStore.setState;
const get = useMistyStore.getState;

/** Runs being followed, by run id. */
const following = new Set<string>();

export const isFollowingRun = (runId: string) => following.has(runId);

/** The last thing an agent said in a chat. */
export function latestReply(
  conversations: readonly GlobalAiConversation[],
  conversationId: string,
): GlobalAiMessage | undefined {
  const chat = conversations.find((item) => item.id === conversationId);
  const replies = chat?.messages.filter((message) => message.role === "assistant");
  return replies?.[replies.length - 1];
}

type Ending = Partial<GlobalAiMessage> & { state: "completed" | "failed" | "canceled" };

/** Follows a run into a chat's reply until it ends. Following one twice does nothing. */
export function followReply(conversationId: string, messageId: string, runId: string) {
  if (following.has(runId)) return;
  following.add(runId);
  let stop = () => {};
  let ended = false;
  const said = () => latestReply(get().conversations, conversationId)?.content ?? "";
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
      // which may be another chat's, so the ending is applied here.
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
