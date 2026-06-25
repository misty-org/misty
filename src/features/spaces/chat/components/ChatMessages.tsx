import type { FormEvent, RefObject, UIEventHandler } from "react";
import type {
  SpaceLibraryItem,
  SpaceMessage,
  SpaceNode,
} from "@/api/spaces/dto/interfaces/types";
import type { SpaceActionSuggestionBatch } from "@/api/spaces/dto/interfaces/actionSuggestionTypes";

export type SpaceChatStarter = "mention" | "files" | "library";

export interface SpaceChatMessagesProps {
  error: string;
  loading: boolean;
  messages: SpaceMessage[];
  /** Agent turns still in flight; drives the typing indicator. */
  actionSuggestions?: SpaceActionSuggestionBatch[];
  onActionSuggestionsChanged?: () => void;
  currentUserId?: string;
  isOwner: boolean;
  canWrite: boolean;
  editingMessageId: string;
  editingText: string;
  editSaving: boolean;
  nodes: SpaceNode[];
  libraryItems: SpaceLibraryItem[];
  canCopyLibrary: boolean;
  canAddToLibrary: boolean;
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
  spaceName?: string;
  directRecipient?: { userId: string; name: string };
  onStarter?: (starter: SpaceChatStarter) => void;
}

export { DeleteMessageDialog } from "./DeleteMessageDialog";
export { messageReplyPreviewText } from "./messageHelpers";
import {
  SocialError as SystemErrorActivity,
  socialErrorMessage as systemErrorMessage,
} from "@/features/spaces/chat/socialRuntime";
import { Button } from "@/shared/ui";
import { CircleAlert, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { buildChatDisplayRows, useMemberAvatarUrls } from "./ChatDisplay";
import { ChatMessageRow } from "./ChatMessageRow";
import { ChatMessagesSkeleton } from "./ChatMessagesSkeleton";
import { SpaceChatStarters } from "./ChatStarters";
import { SpaceDirectMessageIntro } from "./DirectMessageIntro";

export function SpaceChatMessages(props: SpaceChatMessagesProps) {
  const displayRows = useMemo(() => buildChatDisplayRows(props.messages), [props.messages]);
  const memberAvatarUrls = useMemberAvatarUrls(props.spaceId, props.messages);

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
          <>
            <SystemErrorActivity
              error={props.error}
              scope={`social:${props.spaceId}`}
              title="Social messages could not be loaded"
              target={{ kind: "space-chat", spaceId: props.spaceId }}
            />
            <div
              className="mb-3 flex items-start gap-3 rounded-xl border border-charcoal-border bg-charcoal-card px-4 py-3"
              role="alert"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-notification-red" />
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-medium text-cream-bright">
                  Messages couldn’t be loaded
                </p>
                <p className="m-0 mt-0.5 text-xs leading-5 text-cream-muted">
                  {systemErrorMessage(props.error)}
                </p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={props.onReload}>
                <RefreshCw data-icon="inline-start" />
                Try again
              </Button>
            </div>
          </>
        ) : null}

        {props.loading && props.messages.length === 0 ? (
          <ChatMessagesSkeleton />
        ) : props.messages.length === 0 ? (
          props.error ? null : props.directRecipient ? (
            <SpaceDirectMessageIntro spaceId={props.spaceId} recipient={props.directRecipient} />
          ) : (
            <SpaceChatStarters
              spaceName={props.spaceName}
              onStarter={props.canWrite ? props.onStarter : undefined}
            />
          )
        ) : (
          displayRows.map(({ message, compact, dateLabel }) => {
            const repliedToMessage = message.reply_to_message_id
              ? props.messages.find((item) => item.id === message.reply_to_message_id)
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
                props={props}
              />
            );
          })
        )}


        <div ref={props.endRef} />
      </div>
    </div>
  );
}
