import { useEffect, useState } from "react";
import { spacesApi } from "../../api/api";
import type { SpaceEvent } from "../../api/dto/entities";
import { spaceReadEvent, spacesResyncEvent } from "../../list/spaces_resync";

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
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: string; event?: SpaceEvent }>).detail;
      if (detail?.spaceId !== spaceId) return;
      const type = detail.event?.type ?? "";
      if (type === "message.created" && !detail.event?.payload.thread_root_id) return;
      if (type.startsWith("read.") && !detail.event?.payload.thread_root_id) return;
      if (type !== "message.created" && type !== "message.deleted" && !type.startsWith("read."))
        return;
      void load();
    };
    const resync = () => void load();
    window.addEventListener("misty:space-message-event", onEvent);
    window.addEventListener(spaceReadEvent, onEvent);
    window.addEventListener(spacesResyncEvent, resync);
    return () => {
      active = false;
      window.removeEventListener("misty:space-message-event", onEvent);
      window.removeEventListener(spaceReadEvent, onEvent);
      window.removeEventListener(spacesResyncEvent, resync);
    };
  }, [spaceId, conversationId]);
  return unread;
}
