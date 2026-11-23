import { aiSurfaceApi } from "../runs/invocations/api";
import type { AiProgressItem } from "../runs/invocations/invocation_types";
import type { GlobalAiMessage } from "../conversations/state/conversation_types";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { useEffect, useState } from "react";

type StoredHistory = Awaited<ReturnType<typeof aiSurfaceApi.invocationProgress>>;

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

const finished = new Map<string, Promise<StoredHistory>>();

function settled(message: GlobalAiMessage) {
  return (
    message.state === "completed" || message.state === "failed" || message.state === "canceled"
  );
}

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
  return loaded && loaded.id === invocationId ? loaded.items : undefined;
}
