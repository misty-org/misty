import { useMemo } from "react";
import {
  ErrorState,
  ListRow,
  ListRowSkeleton,
  RowGroupSection,
  RowGroupStack,
  type RowState,
} from "@misty/ui";
import { useMistyStore } from "../conversations/state/use_misty_store";
import type { SharedThread } from "./shared_threads";
import { useThreadWork } from "./thread_work";

const sharedState = (state: SharedThread["state"]): RowState => {
  if (state === "working" || state === "landing") return { kind: "working" };
  if (state === "needs-you") return { kind: "waiting" };
  return { kind: "none" };
};

export function AgentThreadList(props: {
  spaceId: string;
  agentId: string;
  shared: boolean;
  others: SharedThread[] | null;
  failed: boolean;
  openConversationId: string;
  openThreadId: string;
  onOpenMine(conversationId: string): void;
  onOpenTheirs(threadId: string): void;
  onRetry(): void;
}) {
  const { agentId, spaceId } = props;
  const conversations = useMistyStore((state) => state.conversations);
  const working = useMistyStore((state) => (state.working ? state.invocationConversationId : null));
  const threads = useThreadWork((state) => state.byConversation);

  const mine = useMemo(
    () =>
      conversations
        .filter((chat) => chat.agentId === agentId && !chat.archivedAt && !chat.place)
        .filter((chat) => !chat.spaceId || !spaceId || chat.spaceId === spaceId)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [conversations, agentId, spaceId],
  );

  const mineState = (conversationId: string): RowState => {
    const thread = threads[conversationId];
    if (thread?.state === "clashed") return { kind: "waiting", label: "Its changes clash" };
    if (working === conversationId || thread?.state === "landing") return { kind: "working" };
    return { kind: "none" };
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <RowGroupStack>
        {mine.length ? (
          <RowGroupSection title={props.shared ? "Your threads" : "Threads"}>
            {mine.map((chat) => (
              <ListRow
                key={chat.id}
                label={chat.title || "New thread"}
                selected={!props.openThreadId && props.openConversationId === chat.id}
                state={mineState(chat.id)}
                onOpen={() => props.onOpenMine(chat.id)}
              />
            ))}
          </RowGroupSection>
        ) : null}
        {props.shared && (props.others === null || props.others.length || props.failed) ? (
          <RowGroupSection title="Everyone's threads">
            {props.failed && !props.others ? (
              <ErrorState
                inline
                title="These threads couldn't load"
                line="Check your connection and try again."
                action={{ label: "Try again", variant: "secondary", onClick: props.onRetry }}
              />
            ) : !props.others ? (
              <ListRowSkeleton rows={3} lines={2} label="Everyone's threads" />
            ) : (
              props.others.map((thread) => (
                <ListRow
                  key={thread.id}
                  label={thread.title || "Thread"}
                  description={thread.owner_name}
                  selected={props.openThreadId === thread.id}
                  state={sharedState(thread.state)}
                  onOpen={() => props.onOpenTheirs(thread.id)}
                />
              ))
            )}
          </RowGroupSection>
        ) : null}
      </RowGroupStack>
    </div>
  );
}
