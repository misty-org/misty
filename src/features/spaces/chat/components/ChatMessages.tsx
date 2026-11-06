import type { FormEvent, RefObject, UIEventHandler } from "react";
import type { SpaceLibraryItem, SpaceMessage, SpaceNode } from "@/api/spaces/dto/entities";

export type SpaceChatStarter = "mention" | "files" | "library";

export interface SpaceChatMessagesProps {
  onRetry?: (message: SpaceMessage) => void;
  error: string;
  loading: boolean;
  messages: SpaceMessage[];
  currentUserId?: string;
  isOwner: boolean;
  canWrite: boolean;
  editingMessageId: string;
  editingText: string;
  editSaving: boolean;
  nodes: SpaceNode[];
  libraryItems: SpaceLibraryItem[];
  spaceId: string;
  endRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  onEditingText: (value: string) => void;
  onCancelEditing: (messageId: string) => void;
  onSaveEdited: (event: FormEvent, message: SpaceMessage) => void;
  onReply: (messageId: string) => void;
  onToggleReaction: (message: SpaceMessage, emoji: string, reacted: boolean) => void;
  onBeginEditing: (message: SpaceMessage) => void;
  onDelete: (message: SpaceMessage) => void;
  onOpenNode: (nodeId: string) => void;
  onError: (message: string) => void;
  onLibraryItem: (item: SpaceLibraryItem) => void;
  onReload: () => void;
  directRecipient?: { userId: string; name: string };
  onStarter?: (starter: SpaceChatStarter) => void;
}

export { DeleteMessageDialog } from "./DeleteMessageDialog";
import { SystemErrorNotice } from "@/features/support/systemErrors";
import { useLayoutEffect, useMemo, useRef } from "react";
import { buildChatDisplayRows, useMemberAvatarUrls } from "./ChatDisplay";
import { ChatMessageRow } from "./ChatMessageRow";
import { threadRootOf } from "./messageHelpers";
import { ChatMessagesSkeleton } from "./ChatMessagesSkeleton";
import { ChatStarters } from "./ChatStarters";
import { DirectMessageIntro } from "./DirectMessageIntro";

export function SpaceChatMessages(props: SpaceChatMessagesProps) {
  const displayRows = useMemo(() => buildChatDisplayRows(props.messages), [props.messages]);
  const memberAvatarUrls = useMemberAvatarUrls(props.spaceId, props.messages);
  const messagesById = useMemo(
    () => new Map(props.messages.map((message) => [message.id, message])),
    [props.messages],
  );
  const rowProps = useStableRowProps(props);
  const replyCounts = useMemo(() => {
    // Threads are flat: every reply, however deep, counts toward its root.
    const counts = new Map<string, number>();
    for (const message of props.messages) {
      if (!message.reply_to_message_id) continue;
      const root = threadRootOf(message, messagesById);
      if (root !== message.id) counts.set(root, (counts.get(root) ?? 0) + 1);
    }
    return counts;
  }, [props.messages, messagesById]);

  const avatarFor = (message: {
    origin?: { author_avatar_url?: string };
    sender_user_id: string;
  }) => message.origin?.author_avatar_url || memberAvatarUrls.get(message.sender_user_id) || "";

  return (
    <div
      ref={props.scrollRef}
      onScroll={props.onScroll}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-[clamp(16px,2.5vw,32px)] pb-3 pt-4"
    >
      <div>
        {props.error ? (
          <SystemErrorNotice
            error={props.error}
            scope={`social:${props.spaceId}`}
            title="Messages could not be loaded"
            onRetry={props.onReload}
          />
        ) : null}

        {props.loading && props.messages.length === 0 ? (
          <ChatMessagesSkeleton />
        ) : props.messages.length === 0 ? (
          props.error ? null : props.directRecipient ? (
            <DirectMessageIntro spaceId={props.spaceId} recipient={props.directRecipient} />
          ) : (
            <ChatStarters onStarter={props.canWrite ? props.onStarter : undefined} />
          )
        ) : (
          displayRows.map(({ message, compact, dateLabel }) => {
            const repliedToMessage = message.reply_to_message_id
              ? messagesById.get(message.reply_to_message_id)
              : undefined;
            return (
              <ChatMessageRow
                key={message.id}
                message={message}
                compact={compact}
                dateLabel={dateLabel}
                avatarUrl={avatarFor(message)}
                repliedToMessage={repliedToMessage}
                repliedToAvatarUrl={repliedToMessage ? avatarFor(repliedToMessage) : ""}
                replyCount={replyCounts.get(message.id) ?? 0}
                props={rowProps}
              />
            );
          })
        )}

        <div ref={props.endRef} />
      </div>
    </div>
  );
}

/**
 * The row callbacks get stable identities that call the latest props, so memoized rows can
 * skip re-rendering while the composer draft changes without ever holding a stale handler.
 */
function useStableRowProps(props: SpaceChatMessagesProps): SpaceChatMessagesProps {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const handlers = useMemo(
    () => ({
      onRetry: (message: SpaceMessage) => latest.current.onRetry?.(message),
      onEditingText: (value: string) => latest.current.onEditingText(value),
      onCancelEditing: (messageId: string) => latest.current.onCancelEditing(messageId),
      onSaveEdited: (event: FormEvent, message: SpaceMessage) =>
        latest.current.onSaveEdited(event, message),
      onReply: (messageId: string) => latest.current.onReply(messageId),
      onToggleReaction: (message: SpaceMessage, emoji: string, reacted: boolean) =>
        latest.current.onToggleReaction(message, emoji, reacted),
      onBeginEditing: (message: SpaceMessage) => latest.current.onBeginEditing(message),
      onDelete: (message: SpaceMessage) => latest.current.onDelete(message),
      onOpenNode: (nodeId: string) => latest.current.onOpenNode(nodeId),
      onError: (message: string) => latest.current.onError(message),
      onLibraryItem: (item: SpaceLibraryItem) => latest.current.onLibraryItem(item),
      onReload: () => latest.current.onReload(),
    }),
    [],
  );
  return { ...props, ...handlers, onRetry: props.onRetry ? handlers.onRetry : undefined };
}
