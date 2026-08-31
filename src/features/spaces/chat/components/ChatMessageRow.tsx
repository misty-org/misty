import type { SpaceChatMessagesProps } from "@/api/spaces/dto/interfaces/components/SpaceChatMessages";
import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import type { MessageSpan } from "@/api/spaces/dto/types/types";
import { avatarColorClass, avatarInkClass, robotAvatarClass } from "@/shared/lib/avatarPalette";
import { Avatar, AvatarFallback, AvatarImage, Badge, cn } from "@/shared/ui";
import { Bot, CircleAlert } from "lucide-react";
import { Fragment, type FormEvent } from "react";
import { SiDiscord } from "react-icons/si";
import { Link } from "react-router-dom";
import { AgentRunInline } from "./AgentRunInline";
import { ChatDateDivider, formatChatMessageTime } from "./ChatDisplay";
import { MessageAttachments } from "./MessageAttachments";
import { MessageEditForm } from "./MessageEditForm";
import { MessageHoverActions } from "./MessageHoverActions";
import { MessageReactions } from "./MessageReactions";
import { MessageReplyPreview } from "./MessageReplyPreview";
import { SuggestedActionsCard } from "./SuggestedActionsCard";
import { initials, isAgentAuthoredMessage, isInFlightRun } from "./messageHelpers";
import { InstagramBrandIcon } from "../../social/InstagramBrandIcon";
import { MessengerBrandIcon, XBrandIcon } from "../../social/SocialProviderBrandIcons";

export interface ChatMessageRowProps {
  message: SpaceMessage;
  compact: boolean;
  dateLabel: string | undefined;
  avatarUrl: string;
  repliedToMessage: SpaceMessage | undefined;
  repliedToAvatarUrl: string;
  props: SpaceChatMessagesProps;
}

/**
 * One message: optional reply preview, gutter, body, attachments and actions.
 *
 * Consecutive messages from the same sender render `compact`, dropping the
 * avatar and header for a timestamp that only appears on hover.
 */
export function ChatMessageRow({
  message,
  compact,
  dateLabel,
  avatarUrl,
  repliedToMessage,
  repliedToAvatarUrl,
  props,
}: ChatMessageRowProps) {
  const rowClass = message.reply_to_message_id ? "row-start-2" : "row-start-1";
  const agentAuthored = isAgentAuthoredMessage(message);

  return (
    <Fragment>
      {dateLabel ? <ChatDateDivider label={dateLabel} /> : null}
      <article
        className={[
          "group relative -mx-3 grid grid-cols-[44px_minmax(0,1fr)] gap-x-4 rounded-xl px-3 py-1",
          "transition-colors duration-150 hover:bg-charcoal-card",
          // `first:` covers the message that opens a thread with no date
          // divider above it, whose top margin would double the scroller's.
          compact ? "" : "mt-4 first:mt-0",
        ].join(" ")}
        id={`message-${message.id}`}
      >
        {message.reply_to_message_id ? (
          <MessageReplyPreview
            avatarUrl={repliedToAvatarUrl}
            message={repliedToMessage}
            onOpen={() =>
              document
                .getElementById(`message-${message.reply_to_message_id}`)
                ?.scrollIntoView({ block: "center" })
            }
          />
        ) : null}

        <div className={`col-start-1 flex justify-end ${rowClass}`}>
          {compact ? (
            <time className="pt-1 text-[10px] tabular-nums text-cream-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
              {formatChatMessageTime(message.created_at)}
            </time>
          ) : (
            <Avatar className="mt-0.5 size-10">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
              <AvatarFallback
                className={cn(
                  "text-xs font-semibold",
                  agentAuthored
                    ? cn(robotAvatarClass, avatarInkClass)
                    : cn(avatarColorClass(message.sender_name), avatarInkClass),
                )}
              >
                {agentAuthored ? (
                  <Bot className="size-4" strokeWidth={2} />
                ) : (
                  initials(message.sender_name)
                )}
              </AvatarFallback>
            </Avatar>
          )}
        </div>

        <div className={`col-start-2 min-w-0 ${rowClass}`}>
          {!compact ? <MessageHeader message={message} /> : null}

          {props.editingMessageId === message.id ? (
            <MessageEditForm
              message={message}
              text={props.editingText}
              saving={props.editSaving}
              onText={props.onEditingText}
              onCancel={props.onCancelEditing}
              onSubmit={(event: FormEvent, target) => props.onSaveEdited(event, target)}
            />
          ) : (
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-6 text-cream/90">
              {message.content.map((span, index) => (
                <MessageContent key={index} span={span} highlightPlainMentions={agentAuthored} />
              ))}
              {message.edited_at ? (
                <span className="ml-1 text-[10px] text-cream-muted">(edited)</span>
              ) : null}
            </p>
          )}

          {message.local_delivery_state === "failed" ? (
            <div
              className="mt-1 flex items-center gap-1.5 text-[11px] text-notification-red"
              role="alert"
            >
              <CircleAlert className="size-3" aria-hidden="true" />
              Message couldn’t be sent.
            </div>
          ) : null}

          <MessageAttachments
            message={message}
            nodes={props.nodes}
            libraryItems={props.libraryItems}
            canCopyLibrary={props.canCopyLibrary}
            canAddToLibrary={props.canAddToLibrary}
            spaceId={props.spaceId}
            onOpenNode={props.onOpenNode}
            onError={props.onError}
            onLibraryItem={props.onLibraryItem}
            onReload={props.onReload}
          />
          {message.triggered_runs
            ?.filter((run) => !isInFlightRun(run))
            .map((run) => (
              <AgentRunInline key={run.id} run={run} />
            ))}
          <MessageReactions
            message={message}
            canWrite={props.canWrite}
            onToggle={props.onToggleReaction}
          />
        </div>

        {props.canWrite && !message.local_delivery_state ? (
          <MessageHoverActions
            message={message}
            currentUserId={props.currentUserId}
            isOwner={props.isOwner}
            onReply={props.onReply}
            onToggleReaction={props.onToggleReaction}
            onBeginEditing={props.onBeginEditing}
            onDelete={props.onDelete}
          />
        ) : null}
      </article>
      {props.actionSuggestions
        ?.filter((batch) => batch.anchor_message_id === message.id)
        .map((batch) => (
          <SuggestedActionsCard
            key={batch.id}
            spaceId={props.spaceId}
            batch={batch}
            onChanged={props.onActionSuggestionsChanged ?? (() => {})}
          />
        ))}
    </Fragment>
  );
}

function MessageHeader({ message }: { message: SpaceMessage }) {
  const agentAuthored = isAgentAuthoredMessage(message);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-5">
      <strong className="text-[15px] font-semibold text-cream">{message.sender_name}</strong>
      {agentAuthored ? (
        <Badge variant="secondary" className="h-4 gap-1 rounded px-1 text-[9px]">
          <Bot />
          Agent
        </Badge>
      ) : null}
      {message.social_provider === "instagram" ? (
        <Badge variant="secondary" className="h-4 gap-1 rounded px-1 text-[9px]">
          <InstagramBrandIcon />
          Instagram
        </Badge>
      ) : message.social_provider === "discord" ? (
        <Badge variant="secondary" className="h-4 gap-1 rounded px-1 text-[9px]">
          <SiDiscord />
          Discord
        </Badge>
      ) : message.social_provider === "messenger" ? (
        <Badge variant="secondary" className="h-4 gap-1 rounded px-1 text-[9px]">
          <MessengerBrandIcon />
          Messenger
        </Badge>
      ) : message.social_provider === "x" ? (
        <Badge variant="secondary" className="h-4 gap-1 rounded px-1 text-[9px]">
          <XBrandIcon />X
        </Badge>
      ) : null}
      <time className="text-[11px] tabular-nums text-cream-muted">
        {formatChatMessageTime(message.created_at)}
      </time>
    </div>
  );
}

function MessageContent({
  span,
  highlightPlainMentions,
}: {
  span: MessageSpan;
  highlightPlainMentions: boolean;
}) {
  if (span.type === "text") {
    return highlightPlainMentions ? <PlainTextWithMentions text={span.text} /> : <>{span.text}</>;
  }
  if (span.type === "link") {
    return (
      <Link className="font-medium text-cream-bright underline underline-offset-2" to={span.url}>
        {span.label}
      </Link>
    );
  }
  return <span className={mentionClassName}>@{span.label}</span>;
}

const mentionClassName =
  "inline-flex items-center rounded-[3px] bg-mention-bg/35 px-1 py-0.5 font-medium text-cream-bright";
const plainMentionPattern = /(@[\p{L}\p{N}_.'’-]+(?:\s+[\p{Lu}][\p{L}\p{N}_.'’-]*){0,2})/gu;

/** Keeps older Agent messages legible before mentions were stored as structured spans. */
function PlainTextWithMentions({ text }: { text: string }) {
  return text.split(plainMentionPattern).map((part, index) =>
    part.startsWith("@") ? (
      <span key={index} className={mentionClassName}>
        {part}
      </span>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
