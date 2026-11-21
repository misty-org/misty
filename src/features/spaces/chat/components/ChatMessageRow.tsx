import { memo, useState } from "react";
import {
  Copy,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Reply,
  SmilePlus,
  Trash2,
} from "lucide-react";
import {
  AddReactionButton,
  Avatar,
  AvatarFallback,
  Badge,
  ChannelMessage,
  ChannelMessageText,
  ChannelReactions,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  MenuSeparator,
  ReactionChip,
  ThreadRepliesButton,
  useNotice,
} from "@misty/ui";
import { AgentMark } from "@/features/agents";
import { LinkPreviews } from "@/features/files";
import type { SpaceMessage } from "../../api/dto/entities";
import type { SpaceChatMessagesProps } from "./ChatMessages";
import { MessageAttachments } from "./MessageAttachments";
import { ChatAvatar } from "./ChatAvatar";
import { PinMenuItem } from "./PinMenuItem";
import { isAgentAuthoredMessage, spansToText } from "./messageText";
import { useChatSidePanel } from "../chatSidePanelStore";
import { SpacePostCard } from "../../handoffs/SpacePostCard";
import { readSpacePost } from "../../handoffs/spacePosts";
import { ChatEmojiPicker, isJumbo, useQuickEmoji } from "../emoji/ChatEmojiPicker";
import { messageTextForLinks, Span, ReplyLine, EditBox } from "./ChatMessageParts";

const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const shortDateTime = new Intl.DateTimeFormat(undefined, {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const fullDateTime = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const sameDay = (left: Date, right: Date) => left.toDateString() === right.toDateString();

/** "Today at 3:45 PM", "Yesterday at 3:45 PM", else the date and time. */
function relativeStamp(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, now)) return `Today at ${time.format(date)}`;
  if (sameDay(date, yesterday)) return `Yesterday at ${time.format(date)}`;
  return shortDateTime.format(date);
}

export interface RowProps {
  message: SpaceMessage;
  grouped: boolean;
  avatarUrl: string;
  replied: SpaceMessage | undefined;
  repliedAvatarUrl: string;
  replyCount: number;
  props: SpaceChatMessagesProps;
}

const rowFields = [
  "canWrite",
  "currentUserId",
  "isOwner",
  "nodes",
  "spaceId",
  "onRetry",
  "hasOlderMessages",
  "directRecipient",
  "memberColors",
  "canManageMessages",
  "myRoleIds",
] as const satisfies readonly (keyof SpaceChatMessagesProps)[];

/** Memoized so typing in the composer doesn't re-render the history; the edit draft only matters to its row. */
export const MessageRow = memo(MessageRowView, (previous, next) => {
  if (
    previous.message !== next.message ||
    previous.grouped !== next.grouped ||
    previous.avatarUrl !== next.avatarUrl ||
    previous.replied !== next.replied ||
    previous.repliedAvatarUrl !== next.repliedAvatarUrl ||
    previous.replyCount !== next.replyCount ||
    rowFields.some((field) => previous.props[field] !== next.props[field])
  )
    return false;
  const id = next.message.id;
  const was = previous.props.editingMessageId === id;
  const is = next.props.editingMessageId === id;
  return (
    was === is &&
    (!is ||
      (previous.props.editingText === next.props.editingText &&
        previous.props.editSaving === next.props.editSaving))
  );
});

function MessageRowView({
  message,
  grouped,
  avatarUrl,
  replied,
  repliedAvatarUrl,
  replyCount,
  props,
}: RowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const quick = useQuickEmoji(3);
  const agent = isAgentAuthoredMessage(message);
  const color = props.memberColors?.get(message.sender_user_id);
  const mentionsMe =
    message.sender_user_id !== props.currentUserId &&
    message.content.some(
      (span) =>
        span.type === "mention" &&
        (("user_id" in span && span.user_id === props.currentUserId) ||
          ("role_id" in span && Boolean(props.myRoleIds?.includes(span.role_id)))),
    );
  const editingThis = props.editingMessageId === message.id;
  const post = readSpacePost(message);
  const { onRetry } = props;
  const failed = message.local_delivery_state === "failed";
  const sent = !message.local_delivery_state;
  useNotice(failed, {
    message: "Message couldn’t be sent.",
    tone: "error",
    action: onRetry ? { label: "Retry", onSelect: () => onRetry(message) } : undefined,
  });
  const text = spansToText(message.content);
  const jumbo = !agent && message.content.every((span) => span.type === "text") && isJumbo(text);
  const canEdit =
    props.canWrite &&
    message.sender_kind === "person" &&
    message.sender_user_id === props.currentUserId;
  const canDelete =
    props.canWrite &&
    (message.sender_user_id === props.currentUserId ||
      props.isOwner ||
      Boolean(props.canManageMessages));
  const reactedWith = (emoji: string) =>
    message.reactions?.some((reaction) => reaction.emoji === emoji && reaction.reacted_by_me) ??
    false;
  const react = (emoji: string) => props.onToggleReaction(message, emoji, reactedWith(emoji));
  const copy = () =>
    void navigator.clipboard
      .writeText(
        message.content.map((span) => (span.type === "text" ? span.text : span.label)).join(""),
      )
      .catch(() => props.onError("Could not copy this message. Try selecting its text."));
  const openThread = () => useChatSidePanel.getState().openThread(message.id);
  const edit = () => requestAnimationFrame(() => props.onBeginEditing(message));
  // The same rows in the ⋯ menu and on a right-click.
  const menuRows = (
    <>
      {props.canWrite ? (
        <MenuItem icon={SmilePlus} label="Add reaction" onSelect={() => setPickerOpen(true)} />
      ) : null}
      {canEdit ? <MenuItem icon={Pencil} label="Edit message" onSelect={edit} /> : null}
      {props.canWrite ? (
        <MenuItem icon={Reply} label="Reply" onSelect={() => props.onReply(message.id)} />
      ) : null}
      {sent ? (
        <MenuItem
          icon={MessagesSquare}
          label={message.reply_count ? "Open thread" : "Create thread"}
          onSelect={openThread}
        />
      ) : null}
      <PinMenuItem
        spaceId={props.spaceId}
        message={message}
        canManageMessages={props.isOwner || Boolean(props.canManageMessages)}
      />
      <MenuItem icon={Copy} label="Copy text" onSelect={copy} />
      {canDelete ? (
        <>
          <MenuSeparator />
          <MenuItem
            icon={Trash2}
            label="Delete message"
            danger
            onSelect={() => props.onDelete(message)}
          />
        </>
      ) : null}
    </>
  );
  const picker = props.canWrite ? (
    <ChatEmojiPicker
      side="left"
      align="start"
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      onSelect={react}
    >
      <IconButton label="Add reaction" aria-pressed={pickerOpen}>
        <SmilePlus />
      </IconButton>
    </ChatEmojiPicker>
  ) : null;
  const tools = editingThis ? undefined : failed ? (
    <>
      {onRetry ? (
        <IconButton label="Retry" onClick={() => onRetry(message)}>
          <RefreshCw />
        </IconButton>
      ) : null}
      {canDelete ? (
        <IconButton label="Delete" onClick={() => props.onDelete(message)}>
          <Trash2 />
        </IconButton>
      ) : null}
    </>
  ) : sent ? (
    <>
      {props.canWrite
        ? quick.map((emoji) => (
            <IconButton
              key={emoji}
              label={`React with ${emoji}`}
              aria-pressed={reactedWith(emoji)}
              onClick={() => react(emoji)}
            >
              <span aria-hidden="true" className="text-control leading-none">
                {emoji}
              </span>
            </IconButton>
          ))
        : null}
      {picker}
      {canEdit ? (
        <IconButton label="Edit" onClick={edit}>
          <Pencil />
        </IconButton>
      ) : props.canWrite ? (
        <IconButton label="Reply" onClick={() => props.onReply(message.id)}>
          <Reply />
        </IconButton>
      ) : null}
      <IconButton label="Create thread" onClick={openThread}>
        <MessagesSquare />
      </IconButton>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <IconButton label="More">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" aria-label="Message actions">
          {menuRows}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  ) : undefined;
  const shownReactions = (message.reactions ?? []).filter((reaction) => reaction.count > 0);
  const row = (
    <ChannelMessage
      id={`message-${message.id}`}
      name={message.sender_name}
      color={color}
      grouped={grouped}
      avatar={
        agent ? (
          <Avatar size="lg">
            <AvatarFallback>
              <AgentMark agentId={message.sender_agent_id} />
            </AvatarFallback>
          </Avatar>
        ) : (
          <ChatAvatar
            id={message.sender_user_id || message.sender_name}
            name={message.sender_name}
            src={avatarUrl || undefined}
            size="lg"
          />
        )
      }
      badge={agent ? <Badge variant="secondary">Agent</Badge> : undefined}
      time={relativeStamp(message.created_at)}
      timeFull={fullDateTime.format(new Date(message.created_at))}
      shortTime={time.format(new Date(message.created_at))}
      dateTime={message.created_at}
      mentioned={mentionsMe}
      editing={editingThis}
      pending={message.local_delivery_state === "sending"}
      active={menuOpen || contextOpen || pickerOpen}
      tools={tools}
      reply={
        message.reply_to_message_id ? (
          <ReplyLine
            replied={replied}
            avatarUrl={repliedAvatarUrl}
            color={replied ? props.memberColors?.get(replied.sender_user_id) : undefined}
            earlier={!replied && Boolean(props.hasOlderMessages)}
            onOpen={() => {
              const id = message.reply_to_message_id ?? "";
              const target = document.getElementById(`message-${id}`);
              if (target) target.scrollIntoView({ block: "center" });
              else if (id && props.hasOlderMessages) props.onJumpToMessage?.(id);
            }}
          />
        ) : undefined
      }
      after={
        editingThis ? undefined : (
          <>
            <LinkPreviews text={messageTextForLinks(message.content)} />
            <MessageAttachments
              message={message}
              nodes={props.nodes}
              spaceId={props.spaceId}
              onOpenNode={props.onOpenNode}
            />
            {shownReactions.length ? (
              <ChannelReactions
                add={
                  props.canWrite ? (
                    <ChatEmojiPicker side="right" align="start" onSelect={react}>
                      <AddReactionButton />
                    </ChatEmojiPicker>
                  ) : undefined
                }
              >
                {shownReactions.map((reaction) => (
                  <ReactionChip
                    key={reaction.emoji}
                    emoji={reaction.emoji}
                    count={reaction.count}
                    mine={reaction.reacted_by_me === true}
                    disabled={!props.canWrite}
                    onToggle={() => react(reaction.emoji)}
                  />
                ))}
              </ChannelReactions>
            ) : null}
            {replyCount > 0 ? <ThreadRepliesButton count={replyCount} onOpen={openThread} /> : null}
          </>
        )
      }
    >
      {editingThis ? (
        <EditBox
          message={message}
          text={props.editingText}
          saving={props.editSaving}
          onText={props.onEditingText}
          onCancel={props.onCancelEditing}
          onSubmit={props.onSaveEdited}
        />
      ) : post ? (
        <SpacePostCard
          message={message}
          post={post}
          spaceId={props.spaceId}
          direct={Boolean(props.directRecipient)}
          onError={props.onError}
        />
      ) : (
        <ChannelMessageText
          jumbo={jumbo}
          failed={failed}
          edited={
            message.edited_at
              ? `Edited ${fullDateTime.format(new Date(message.edited_at))}`
              : undefined
          }
        >
          {message.content.map((span, index) => (
            <Span key={index} span={span} plainMentions={agent} />
          ))}
        </ChannelMessageText>
      )}
    </ChannelMessage>
  );
  if (editingThis) return row;
  return (
    <ContextMenu onOpenChange={setContextOpen}>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent aria-label="Message actions">{menuRows}</ContextMenuContent>
    </ContextMenu>
  );
}
