import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { spacesApi } from "../../api/api";
import type { SpaceThread } from "../../api/dto/entities";
import { EmptyState, IconButton, ListRow, Surface, Text } from "@misty/ui";
import { useChatSidePanel } from "../chat_side_panel_store";
import { spansToText } from "./message_text";

export function ChatThreadsList({
  spaceId,
  conversationId,
}: {
  spaceId: string;
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
          setThreads(
            next.filter((thread) => (thread.root.conversation_id ?? "") === conversationId),
          );
          setError("");
        })
        .catch((reason) => {
          if (active)
            setError(reason instanceof Error ? reason.message : "Threads could not be loaded.");
        });
    void load();
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
      className="flex w-[min(--spacing(90),40%)] shrink-0 flex-col"
    >
      <header className="flex min-h-12 items-center gap-2 border-b px-3 py-1.5">
        <Text
          bare
          as="h2"
          size="control"
          tone="bright"
          weight="medium"
          className="m-0 min-w-0 flex-1"
        >
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
          <Text as="p" size="control" tone="failed" wrap className="m-0 px-2 py-1">
            {error}
          </Text>
        ) : threads?.length === 0 ? (
          <EmptyState inline title="No threads yet" line="Start one from a message." />
        ) : (
          (threads ?? []).map((thread) => (
            <ListRow
              key={thread.root.id}
              label={spansToText(thread.root.content) || "Message"}
              description={`${thread.reply_count} ${thread.reply_count === 1 ? "reply" : "replies"} to ${thread.root.sender_name}`}
              state={
                thread.unread_count > 0
                  ? { kind: "unread" }
                  : { kind: "time", at: thread.last_reply_at }
              }
              onOpen={() =>
                useChatSidePanel.getState().openThread(thread.root.id, thread.root, true)
              }
            />
          ))
        )}
      </div>
    </Surface>
  );
}
