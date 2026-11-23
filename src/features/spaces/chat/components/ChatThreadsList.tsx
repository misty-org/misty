import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { spacesApi } from "../../api/api";
import type { SpaceEvent, SpaceThread } from "../../api/dto/entities";
import { spaceReadEvent, spacesResyncEvent } from "../../list/spaces_resync";
import {
  EmptyState,
  ErrorState,
  FramedBar,
  IconButton,
  ListRow,
  ListRowSkeleton,
  Text,
} from "@misty/ui";
import { useChatSidePanel } from "../chat_side_panel_store";
import { spansToText } from "./message_text";

export function ChatThreadsHeader() {
  return (
    <FramedBar
      start={
        <Text as="h2" size="control" weight="semibold" tone="bright" className="min-w-0">
          Threads
        </Text>
      }
    >
      <IconButton
        label="Close threads"
        onClick={() => useChatSidePanel.getState().closeThreadsList()}
      >
        <X />
      </IconButton>
    </FramedBar>
  );
}

export function ChatThreadsList({
  spaceId,
  conversationId,
}: {
  spaceId: string;
  conversationId: string;
}) {
  const [threads, setThreads] = useState<SpaceThread[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
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
    const onRead = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: string; event?: SpaceEvent }>).detail;
      if (detail?.spaceId !== spaceId || !detail.event?.payload.thread_root_id) return;
      void load();
    };
    window.addEventListener("misty:space-message-event", onEvent);
    window.addEventListener(spaceReadEvent, onRead);
    window.addEventListener(spacesResyncEvent, onEvent);
    return () => {
      active = false;
      window.removeEventListener("misty:space-message-event", onEvent);
      window.removeEventListener(spaceReadEvent, onRead);
      window.removeEventListener(spacesResyncEvent, onEvent);
    };
  }, [spaceId, conversationId, attempt]);
  return (
    <section aria-label="Threads" className="min-h-0 flex-1 overflow-y-auto p-2">
      {error && !threads ? (
        <ErrorState
          inline
          title="Threads couldn’t load"
          line={error}
          action={{
            label: "Try again",
            variant: "secondary",
            onClick: () => {
              setError("");
              setAttempt((count) => count + 1);
            },
          }}
        />
      ) : !threads ? (
        <ListRowSkeleton label="Threads" rows={4} lines={2} state />
      ) : threads.length === 0 ? (
        <EmptyState inline title="No threads yet" line="Start one from a message." />
      ) : (
        threads.map((thread) => (
          <ListRow
            key={thread.root.id}
            label={spansToText(thread.root.content) || "Message"}
            description={`${thread.reply_count} ${thread.reply_count === 1 ? "reply" : "replies"} to ${thread.root.sender_name}`}
            state={
              thread.unread_count > 0
                ? { kind: "unread" }
                : { kind: "time", at: thread.last_reply_at }
            }
            onOpen={() => useChatSidePanel.getState().openThread(thread.root.id, thread.root, true)}
          />
        ))
      )}
    </section>
  );
}
