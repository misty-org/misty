import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { spacesApi } from "../../api/api";
import type { SpaceThread } from "../../api/dto/entities";
import { IconButton, ListRow, Surface, Text } from "@misty/ui";
import { useChatSidePanel } from "../chatSidePanelStore";
import { spansToText } from "./messageText";

/**
 * The threads the person follows in this chat (the ones they started or replied to), most recently
 * replied to first, in the same panel a thread opens in. A thread with replies they haven't read shows
 * the unread dot.
 */
export function ChatThreadsList({
  spaceId,
  conversationId,
}: {
  spaceId: string;
  /** The chat whose threads are listed; "" for the Space's Everyone chat. */
  conversationId: string;
}) {
  const [threads, setThreads] = useState<SpaceThread[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      spacesApi
        .threads(spaceId)
        .then(({ threads: next }) => {
          if (!active) return;
          setThreads(next.filter((thread) => (thread.root.conversation_id ?? "") === conversationId));
          setError("");
        })
        .catch((reason) => {
          if (active)
            setError(reason instanceof Error ? reason.message : "Threads could not be loaded.");
        });
    void load();
    // A reply anywhere in the Space moves a thread up and changes its unread.
    const onEvent = () => void load();
    window.addEventListener("misty:space-message-event", onEvent);
    return () => {
      active = false;
      window.removeEventListener("misty:space-message-event", onEvent);
    };
  }, [spaceId, conversationId]);
  return (
    <Surface
      as="aside"
      tone="page"
      aria-label="Threads"
      className="flex w-[min(22.5rem,40%)] shrink-0 flex-col"
    >
      <header className="flex min-h-12 items-center gap-2 border-b px-3 py-1.5">
        <Text bare as="h2" tone="bright" className="m-0 min-w-0 flex-1 text-sm font-medium">
          Threads
        </Text>
        <IconButton
          label="Close threads"
          size="sm"
          onClick={() => useChatSidePanel.getState().closeThreadsList()}
        >
          <X />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && !threads ? (
          <Text as="p" tone="failed" className="m-0 px-2 py-1 text-sm">
            {error}
          </Text>
        ) : threads?.length === 0 ? (
          <Text as="p" tone="muted" className="m-0 px-2 py-1 text-sm">
            No threads yet. Start one from a message.
          </Text>
        ) : (
          (threads ?? []).map((thread) => (
            <ListRow
              key={thread.root.id}
              label={spansToText(thread.root.content) || "Message"}
              description={`${thread.reply_count} ${thread.reply_count === 1 ? "reply" : "replies"} · ${thread.root.sender_name}`}
              state={
                thread.unread_count > 0
                  ? { kind: "unread" }
                  : { kind: "time", at: thread.last_reply_at }
              }
              onOpen={() => useChatSidePanel.getState().openThread(thread.root.id, thread.root, true)}
            />
          ))
        )}
      </div>
    </Surface>
  );
}
