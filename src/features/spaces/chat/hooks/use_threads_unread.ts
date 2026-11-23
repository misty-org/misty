import { useEffect, useState } from "react";
import { spacesApi } from "../../api/api";

export function useThreadsUnread(spaceId: string, conversationId: string): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () =>
      spacesApi
        .threads(spaceId)
        .then(({ threads }) => {
          if (!active) return;
          setUnread(
            threads
              .filter((thread) => (thread.root.conversation_id ?? "") === conversationId)
              .reduce((total, thread) => total + Math.max(0, thread.unread_count), 0),
          );
        })
        .catch(() => undefined);
    void load();
    const onEvent = () => void load();
    window.addEventListener("misty:space-message-event", onEvent);
    return () => {
      active = false;
      window.removeEventListener("misty:space-message-event", onEvent);
    };
  }, [spaceId, conversationId]);
  return unread;
}
