import { subscribeAgentsInvocation } from "@/features/agents/agents_runtime";
import { followAddress } from "../../runs/local-run/local_run_parts";
import type { GlobalAiConversation, GlobalAiMessage } from "./conversation_types";
import {
  applyGlobalInvocationEvent,
  flushStreamedText,
  settleConversationMessage,
} from "./misty_store_updates";
import { useMistyStore } from "./use_misty_store";

const set = useMistyStore.setState;
const get = useMistyStore.getState;

const following = new Set<string>();

export const isFollowingRun = (runId: string) => following.has(runId);

export function latestReply(
  conversations: readonly GlobalAiConversation[],
  conversationId: string,
): GlobalAiMessage | undefined {
  const chat = conversations.find((item) => item.id === conversationId);
  const replies = chat?.messages.filter((message) => message.role === "assistant");
  return replies?.[replies.length - 1];
}

type Ending = Partial<GlobalAiMessage> & { state: "completed" | "failed" | "canceled" };

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
