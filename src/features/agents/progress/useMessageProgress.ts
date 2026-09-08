import { aiSurfaceApi } from "@/features/ai-surface/api";
import type { AiProgressItem } from "@/features/ai-surface/types";
import type { GlobalAiMessage } from "@/features/global-search/types";
import { useEffect, useState } from "react";

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
 * from its stored events.
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
    });
    return () => {
      current = false;
    };
  }, [fetchable, invocationId]);
  if (message.progress) return message.progress;
  // Messages without a run (the user's own) have no invocation id to match.
  return loaded && loaded.id === invocationId ? loaded.items : undefined;
}
