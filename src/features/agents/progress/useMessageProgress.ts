import { aiSurfaceApi } from "@/features/ai-surface/api";
import type { AiProgressItem } from "@/features/ai-surface/types";
import type { GlobalAiMessage } from "@/features/global-search/types";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useEffect, useState } from "react";

/**
 * Keeps a fetched timeline with its reply, so the chat saved on this device has it after
 * the server lets the run go (docs/design/agent-chats-local/BRIEF.md).
 */
function keepProgress(invocationId: string, items: AiProgressItem[]) {
  if (!items.length) return;
  const owns = (message: GlobalAiMessage) =>
    message.role === "assistant" && message.invocationId === invocationId && !message.progress;
  useMistyStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      conversation.messages.some(owns)
        ? {
            ...conversation,
            messages: conversation.messages.map((message) =>
              owns(message) ? { ...message, progress: items } : message,
            ),
          }
        : conversation,
    ),
  }));
}

/** Finished replies never change, so each is fetched once per session. */
const finished = new Map<string, Promise<AiProgressItem[]>>();

function settled(message: GlobalAiMessage) {
  return (
    message.state === "completed" || message.state === "failed" || message.state === "canceled"
  );
}

/**
 * A reply's timeline. While it streams, the store builds it from live tool
 * events; a reply loaded from history fetches the same timeline once, rebuilt
 * from its stored events, and keeps it with the chat.
 */
export function useMessageProgress(message: GlobalAiMessage): AiProgressItem[] | undefined {
  const invocationId = message.role === "assistant" ? message.invocationId : undefined;
  const fetchable = !message.progress && Boolean(invocationId) && settled(message);
  const [loaded, setLoaded] = useState<{ id: string; items: AiProgressItem[] }>();
  useEffect(() => {
    if (!fetchable || !invocationId) return;
    let current = true;
    let request = finished.get(invocationId);
    if (!request) {
      request = aiSurfaceApi.invocationProgress(invocationId).then(
        (response) => response.items ?? [],
        () => {
          // Leave the reply without a timeline, and try again next time it shows.
          finished.delete(invocationId);
          return [];
        },
      );
      finished.set(invocationId, request);
    }
    void request.then((items) => {
      if (current) setLoaded({ id: invocationId, items });
      keepProgress(invocationId, items);
    });
    return () => {
      current = false;
    };
  }, [fetchable, invocationId]);
  if (message.progress) return message.progress;
  // Messages without a run (the user's own) have no invocation id to match.
  return loaded && loaded.id === invocationId ? loaded.items : undefined;
}
