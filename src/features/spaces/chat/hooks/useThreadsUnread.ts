import { useEffect, useState } from "react";
import { spacesApi } from "../../api/api";

/**
 * How many replies the person hasn't read across a chat's threads they follow, for the Threads button.
 * It reads the same list the Threads panel does, again whenever a message comes in anywhere in the Space;
 * 0 while it loads or when it can't.
 */
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
