import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  Copy,
  Hash,
  Lock,
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
  Button,
  ChannelDivider,
  ChannelMessage,
  ChannelMessageText,
  ChannelReactions,
  ChannelReply,
  ChannelWelcome,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  InlineLink,
  MenuItem,
  MenuSeparator,
  ReactionChip,
  RoleMention,
  Textarea,
  ThreadRepliesButton,
  useNotice,
} from "@misty/ui";
import { SystemErrorNotice } from "@/shared/platform/systemErrors";
import { AgentMark } from "@/features/agents";
import { LinkPreviews } from "@/features/files";
import type { SpaceLibraryItem, SpaceMessage } from "../../api/dto/entities";
import type { MessageSpan } from "../../api/dto/common";
import type { SpaceChatMessagesProps } from "./ChatMessages";
import { buildChatDisplayRows, useMemberAvatarUrls } from "./ChatDisplay";
import { MessageAttachments } from "./MessageAttachments";
import { DirectMessageIntro } from "./DirectMessageIntro";
import { ChatStarters } from "./ChatStarters";
import { ChatMessagesLoading } from "./ChatMessagesLoading";
import { ChatAvatar } from "./ChatAvatar";
import { isAgentAuthoredMessage, messageReplyPreviewText, spansToText } from "./messageText";
import { useChatSidePanel } from "../chatSidePanelStore";
import { useSpaceRolesStore } from "../../roles/useSpaceRoles";
import { SpacePostCard } from "../../handoffs/SpacePostCard";
import { readSpacePost } from "../../handoffs/spacePosts";
import { ChatEmojiPicker, isJumbo, useQuickEmoji } from "../emoji/ChatEmojiPicker";

const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
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

/**
 * A Space chat's history, as Discord lays it out, from @misty/ui's channel pieces: the channel's
 * welcome at the start, a line for each day and one where the unread messages begin, and each
 * message with its sender, its reply line, its files, reactions and thread.
 */
export function ChatMessageList(props: SpaceChatMessagesProps) {
  const rows = useMemo(() => buildChatDisplayRows(props.messages), [props.messages]);
  const avatars = useMemberAvatarUrls(props.spaceId, props.messages);
  const byId = useMemo(
    () => new Map(props.messages.map((message) => [message.id, message])),
    [props.messages],
  );
  const rowProps = useStableRowProps(props);
  const avatarFor = (message: SpaceMessage) =>
    message.origin?.author_avatar_url || avatars.get(message.sender_user_id) || "";
  const atStart = !props.hasOlderMessages || !props.messages.length;
  const stream: ReactNode[] = [];
  for (const { message, compact, dateLabel } of rows) {
    const unread = message.id === props.firstUnreadId;
    const day = dateLabel ? longDate.format(new Date(message.created_at)) : undefined;
    if (day || unread)
      stream.push(
        <div key={`divider:${message.id}`} className="px-4">
          <ChannelDivider label={day} kind={unread ? "new" : "date"} />
        </div>,
      );
    const replied = message.reply_to_message_id ? byId.get(message.reply_to_message_id) : undefined;
    stream.push(
      <MessageRow
        key={message.id}
        message={message}
        grouped={compact && !unread}
        avatarUrl={avatarFor(message)}
        replied={replied}
        repliedAvatarUrl={replied ? avatarFor(replied) : ""}
        replyCount={message.reply_count ?? 0}
        props={rowProps}
      />,
    );
  }
  return (
    <div
      ref={props.scrollRef}
      onScroll={props.onScroll}
      className="misty-scrollbar-flush flex min-h-0 flex-1 flex-col overflow-y-auto [overflow-anchor:none]"
    >
      <div role="log" aria-label="Messages" className="mt-auto flex min-w-0 flex-col pt-4 pb-6">
        {props.error ? (
          <div className="px-4 pb-2">
            <SystemErrorNotice
              error={props.error}
              scope={`social:${props.spaceId}`}
              title="Messages could not be loaded"
              onRetry={props.onReload}
            />
          </div>
        ) : null}
        {props.loading && !props.messages.length ? (
          <ChatMessagesLoading />
        ) : props.error && !props.messages.length ? null : (
          <>
            {!atStart ? null : props.directRecipient ? (
              <div className="px-4">
                <DirectMessageIntro spaceId={props.spaceId} recipient={props.directRecipient} />
              </div>
            ) : props.channel ? (
              <div className="px-4">
                <ChannelWelcome
                  icon={props.channel.private ? Lock : Hash}
                  title={`Welcome to #${props.channel.name}`}
                  line={`This is the start of #${props.channel.name}.`}
                />
              </div>
            ) : !props.messages.length ? (
              <ChatStarters onStarter={props.canWrite ? props.onStarter : undefined} />
            ) : null}
            {stream}
          </>
        )}
        <div ref={props.endRef} />
      </div>
    </div>
  );
}

/** Row handlers that call the latest props, so memoized rows skip re-rendering while typing. */
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
      onJumpToMessage: (messageId: string) => latest.current.onJumpToMessage?.(messageId),
    }),
    [],
  );
  return { ...props, ...handlers, onRetry: props.onRetry ? handlers.onRetry : undefined };
}

interface RowProps {
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
  "libraryItems",
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
const MessageRow = memo(MessageRowView, (previous, next) => {
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
              libraryItems={props.libraryItems}
              spaceId={props.spaceId}
              onOpenNode={props.onOpenNode}
              onError={props.onError}
              onLibraryItem={props.onLibraryItem}
              onReload={props.onReload}
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

function messageTextForLinks(spans: MessageSpan[]): string {
  return spans
    .map((span) => (span.type === "text" ? span.text : span.type === "link" ? ` ${span.url} ` : ""))
    .join("");
}

/** A span of a message: words, a link, or a mention. */
function Span(props: { span: MessageSpan; plainMentions: boolean }) {
  const { span } = props;
  if (span.type === "text") {
    // An agent writes its mentions into its text; they read as mentions all the same.
    if (!props.plainMentions) return <>{span.text}</>;
    return span.text
      .split(/(@[\p{L}\p{N}_.'’-]+(?:\s+[\p{Lu}][\p{L}\p{N}_.'’-]*){0,2})/gu)
      .map((part, index) =>
        part.startsWith("@") ? (
          <RoleMention key={index} label={part.slice(1)} />
        ) : (
          <span key={index}>{part}</span>
        ),
      );
  }
  if (span.type === "link")
    return (
      <InlineLink asChild>
        <Link to={span.url}>{span.label}</Link>
      </InlineLink>
    );
  if ("role_id" in span) return <ChatRoleMention roleId={span.role_id} label={span.label} />;
  return <RoleMention label={span.label} />;
}

/** A role mention in its role's color, or as any other mention once the role is gone. */
function ChatRoleMention(props: { roleId: string; label: string }) {
  const role = useSpaceRolesStore((state) => {
    for (const roles of Object.values(state.bySpace)) {
      const found = roles.find((item) => item.id === props.roleId);
      if (found) return found;
    }
    return undefined;
  });
  return <RoleMention color={role?.color || undefined} label={role?.name ?? props.label} />;
}

/** The line over a reply: the original's sender and a line of it, or why it isn't there. */
function ReplyLine(props: {
  replied: SpaceMessage | undefined;
  avatarUrl: string;
  color?: string;
  earlier: boolean;
  onOpen(): void;
}) {
  const { replied } = props;
  if (!replied)
    return <ChannelReply missing={props.earlier ? "earlier" : "deleted"} onOpen={props.onOpen} />;
  return (
    <ChannelReply
      avatar={
        <ChatAvatar
          id={replied.sender_user_id || replied.sender_name}
          name={replied.sender_name}
          src={props.avatarUrl || undefined}
          size="xs"
        />
      }
      name={replied.sender_name}
      color={props.color}
      text={messageReplyPreviewText(replied)}
      onOpen={props.onOpen}
    />
  );
}

/** A message being edited: its text in a box, Escape to cancel and Enter to save, with both as buttons. */
function EditBox(props: {
  message: SpaceMessage;
  text: string;
  saving: boolean;
  onText(value: string): void;
  onCancel(messageId: string): void;
  onSubmit(event: FormEvent, message: SpaceMessage): void;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className="grid gap-2 py-1"
      onSubmit={(event) => props.onSubmit(event, props.message)}
    >
      <Textarea
        autoFocus
        rows={1}
        maxLength={4000}
        aria-label="Edit message"
        value={props.text}
        className="max-h-80 resize-none"
        onChange={(event) => props.onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && !event.shiftKey && !props.saving) {
            event.preventDefault();
            props.onCancel(props.message.id);
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (props.text.trim() && !props.saving) form.current?.requestSubmit();
          }
        }}
      />
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="quiet"
          size="sm"
          disabled={props.saving}
          onClick={() => props.onCancel(props.message.id)}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={props.saving || !props.text.trim()}
        >
          Save
        </Button>
      </div>
    </form>
  );
}
