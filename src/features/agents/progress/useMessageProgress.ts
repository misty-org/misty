import { aiSurfaceApi } from "@/features/ai-surface/api";
import type { AiProgressItem } from "@/features/ai-surface/types";
import type { GlobalAiMessage } from "@/features/misty/types";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useEffect, useState } from "react";

type StoredHistory = Awaited<ReturnType<typeof aiSurfaceApi.invocationProgress>>;

/** Keeps a fetched timeline with its reply, with the reply's sources, notebook and sub-agents. */
function keepProgress(invocationId: string, stored: StoredHistory) {
  const items = stored.items ?? [];
  if (!items.length && !stored.citations?.length && !stored.notebook && !stored.subagents) return;
  const owns = (message: GlobalAiMessage) =>
    message.role === "assistant" && message.invocationId === invocationId && !message.progress;
  useMistyStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      conversation.messages.some(owns)
        ? {
            ...conversation,
            messages: conversation.messages.map((message) =>
              owns(message)
                ? {
                    ...message,
                    progress: items,
                    citations:
                      message.citations ?? (stored.citations as GlobalAiMessage["citations"]),
                    notebook: message.notebook ?? stored.notebook,
                    subagents: message.subagents ?? stored.subagents,
                  }
                : message,
            ),
          }
        : conversation,
    ),
  }));
}

/** Finished replies never change, so each is fetched once per session. */
const finished = new Map<string, Promise<StoredHistory>>();

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
      request = aiSurfaceApi.invocationProgress(invocationId).catch(() => {
        // Leave the reply without a timeline, and try again next time it shows.
        finished.delete(invocationId);
        return { items: [] };
      });
      finished.set(invocationId, request);
    }
    void request.then((stored) => {
      if (current) setLoaded({ id: invocationId, items: stored.items ?? [] });
      keepProgress(invocationId, stored);
    });
    return () => {
      current = false;
    };
  }, [fetchable, invocationId]);
  if (message.progress) return message.progress;
  // Messages without a run (the user's own) have no invocation id to match.
  return loaded && loaded.id === invocationId ? loaded.items : undefined;
}
