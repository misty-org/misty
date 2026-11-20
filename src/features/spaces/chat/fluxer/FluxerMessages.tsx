// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Fluxer (https://github.com/fluxerapp/fluxer): features/channel/components/
// ChannelMessages.tsx, ChannelMessageStream.tsx, MessageGroup.tsx, ChannelMessage.tsx,
// UserMessage.tsx, MessageAuthorInfo.tsx, ReplyPreview.tsx, ChannelDivider.tsx,
// ChannelWelcomeSection.tsx, MessageReactions.tsx, MessageActionBar.tsx, EditingMessageInput.tsx
// and the mention and emoji renderers, with their CSS, over Misty's Space messages.
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
  Ellipsis,
  Hash,
  Lock,
  MessagesSquare,
  Pencil,
  RefreshCw,
  Reply,
  Smile,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useNotice } from "@misty/ui";
import { SystemErrorNotice } from "@/shared/platform/systemErrors";
import { AgentMark } from "@/features/agents";
import { LinkPreviews } from "@/features/files";
import type { SpaceLibraryItem, SpaceMessage } from "../../api/dto/entities";
import type { MessageSpan } from "../../api/dto/common";
import type { CSSProperties, Ref, RefObject } from "react";
import type { SpaceChatMessagesProps } from "../components/ChatMessages";
import { buildChatDisplayRows, useMemberAvatarUrls } from "../components/ChatDisplay";
import { MessageAttachments } from "../components/MessageAttachments";
import { DirectMessageIntro } from "../components/DirectMessageIntro";
import { ChatStarters } from "../components/ChatStarters";
import { ChatMessagesSkeleton } from "../components/ChatMessagesSkeleton";
import {
  isAgentAuthoredMessage,
  messageReplyPreviewText,
  spansToText,
} from "../components/messageText";
import { useChatSidePanel } from "../chatSidePanelStore";
import { useSpaceRolesStore } from "../../roles/useSpaceRoles";
import { SpacePostCard } from "../../handoffs/SpacePostCard";
import { readSpacePost } from "../../handoffs/spacePosts";
import { FluxerScroller } from "./FluxerScroller";
import { FluxerAvatar } from "./FluxerAvatar";
import { FluxerTooltip } from "./FluxerTooltip";
import { FluxerEmojiPicker } from "./FluxerEmojiPicker";
import { FluxerMenu, type FluxerMenuGroups, type MenuPoint } from "./FluxerMenu";
import { isJumbo, Twemoji, TwemojiText } from "./Twemoji";
import { useFrequentEmoji } from "./emojiData";
import { cx } from "./cx";
import list from "./css/ChannelMessages.module.css";
import m from "./css/Message.module.css";
import markup from "./css/Markup.module.css";
import divider from "./css/ChannelDivider.module.css";
import welcome from "./css/ChannelWelcomeSection.module.css";
import reactions from "./css/MessageReactions.module.css";
import bar from "./css/MessageActionBar.module.css";
import tag from "./css/ChannelUserTag.module.css";
import stamp from "./css/TimestampWithTooltip.module.css";
import editing from "./css/EditingMessageInput.module.css";
import textarea from "./css/TextareaInput.module.css";
import menu from "./css/ContextMenu.module.css";

/** DEFAULT_QUICK_EMOJI_NAMES: thumbsup, ok_hand, tada, used until the person has favorites. */
const DEFAULT_QUICK = ["👍", "👌", "🎉"];

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

function sameDay(left: Date, right: Date) {
  return left.toDateString() === right.toDateString();
}

/** getRelativeDateString: "Today at 3:45 PM", "Yesterday at 3:45 PM", else the date and time. */
function relativeStamp(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, now)) return `Today at ${time.format(date)}`;
  if (sameDay(date, yesterday)) return `Yesterday at ${time.format(date)}`;
  return shortDateTime.format(date);
}

export function FluxerMessages(props: SpaceChatMessagesProps) {
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
  rows.forEach(({ message, compact, dateLabel }, index) => {
    const unread = message.id === props.firstUnreadId;
    if (dateLabel) {
      stream.push(
        unread ? (
          <div
            key={`divider:${message.id}`}
            role="separator"
            aria-label={`New messages, ${longDate.format(new Date(message.created_at))}`}
            className={cx(divider.unreadContainer, divider.unreadDate)}
            style={{ marginTop: 16, marginBottom: 16 }}
          >
            <div className={divider.unreadLine} />
            <span className={divider.dateWithUnreadText}>
              {longDate.format(new Date(message.created_at))}
            </span>
            <div className={divider.unreadLine} />
            <span className={divider.unreadBadge}>New</span>
          </div>
        ) : (
          <div
            key={`divider:${message.id}`}
            role="separator"
            className={divider.container}
            style={{ marginTop: 16, marginBottom: 16 }}
          >
            <div className={divider.line} />
            <span className={divider.text}>{longDate.format(new Date(message.created_at))}</span>
            <div className={divider.line} />
          </div>
        ),
      );
    } else if (unread) {
      stream.push(
        <div
          key={`unread:${message.id}`}
          role="separator"
          aria-label="New messages"
          className={divider.unreadContainer}
        >
          <div className={divider.unreadLine} />
          <span className={divider.unreadBadge}>New</span>
        </div>,
      );
    } else if (!compact && index > 0) {
      stream.push(<div key={`spacer:${message.id}`} className={list.groupSpacer} aria-hidden />);
    }
    const replied = message.reply_to_message_id ? byId.get(message.reply_to_message_id) : undefined;
    stream.push(
      <MessageRow
        key={message.id}
        message={message}
        grouped={compact}
        avatarUrl={avatarFor(message)}
        replied={replied}
        repliedAvatarUrl={replied ? avatarFor(replied) : ""}
        replyCount={message.reply_count ?? 0}
        props={rowProps}
      />,
    );
  });
  return (
    <div className={list.messagesWrapper}>
      <div className={list.scrollerContainer}>
        <FluxerScroller
          ref={props.scrollRef}
          onScroll={props.onScroll}
          scrollbar="regular"
          fade={false}
        >
          <div className={list.scrollerContent}>
            <div className={list.scrollerInner} role="log" aria-label="Messages">
              {props.error ? (
                <SystemErrorNotice
                  error={props.error}
                  scope={`social:${props.spaceId}`}
                  title="Messages could not be loaded"
                  onRetry={props.onReload}
                />
              ) : null}
              {props.loading && !props.messages.length ? (
                <ChatMessagesSkeleton />
              ) : props.error && !props.messages.length ? null : (
                <>
                  {!atStart ? (
                    <div className={list.fillerBuffer} />
                  ) : props.directRecipient ? (
                    <div style={{ marginTop: "auto" }}>
                      <DirectMessageIntro
                        spaceId={props.spaceId}
                        recipient={props.directRecipient}
                      />
                    </div>
                  ) : props.channel ? (
                    <ChannelWelcome name={props.channel.name} locked={props.channel.private} />
                  ) : !props.messages.length ? (
                    <ChatStarters onStarter={props.canWrite ? props.onStarter : undefined} />
                  ) : null}
                  {stream}
                </>
              )}
              <div className={list.scrollerSpacer} />
              <div ref={props.endRef} />
            </div>
          </div>
        </FluxerScroller>
      </div>
    </div>
  );
}

/** ChannelWelcomeSection: the 80px # circle, "Welcome to #name", where the channel starts. */
function ChannelWelcome(props: { name: string; locked: boolean }) {
  const Glyph = props.locked ? Lock : Hash;
  return (
    <div className={welcome.container}>
      <div className={cx("pointer-events-none", welcome.channelIcon)}>
        <Glyph className={welcome.iconSize} />
      </div>
      <h1 className={welcome.heading}>{`Welcome to #${props.name}`}</h1>
      <p className={welcome.description}>{`This is the start of #${props.name}.`}</p>
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

/** One message laid out on Fluxer's grid: gutter, 40px avatar, gutter, content. */
function MessageRowView({
  message,
  grouped,
  avatarUrl,
  replied,
  repliedAvatarUrl,
  replyCount,
  props,
}: RowProps) {
  const [hovered, setHovered] = useState(false);
  const [shift, setShift] = useState(false);
  const [menuAt, setMenuAt] = useState<MenuPoint | null>(null);
  const [barMenu, setBarMenu] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
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
  useNotice(message.local_delivery_state === "failed", {
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
  const react = (emoji: string) =>
    props.onToggleReaction(
      message,
      emoji,
      message.reactions?.some((reaction) => reaction.emoji === emoji && reaction.reacted_by_me) ??
        false,
    );
  const copy = () =>
    void navigator.clipboard
      .writeText(
        message.content.map((span) => (span.type === "text" ? span.text : span.label)).join(""),
      )
      .catch(() => props.onError("Could not copy this message. Try selecting its text."));
  const menuGroups: FluxerMenuGroups = [
    [
      ...(props.canWrite
        ? [{ label: "Add reaction", icon: Smile, onSelect: () => setPickerOpen(true) }]
        : []),
      ...(canEdit
        ? [
            {
              label: "Edit message",
              icon: Pencil,
              onSelect: () => requestAnimationFrame(() => props.onBeginEditing(message)),
            },
          ]
        : []),
      ...(props.canWrite
        ? [{ label: "Reply", icon: Reply, onSelect: () => props.onReply(message.id) }]
        : []),
      ...(message.local_delivery_state
        ? []
        : [
            {
              label: message.reply_count ? "Open thread" : "Create thread",
              icon: MessagesSquare,
              onSelect: () => useChatSidePanel.getState().openThread(message.id),
            },
          ]),
    ],
    [{ label: "Copy text", icon: Copy, onSelect: copy }],
    canDelete
      ? [
          {
            label: "Delete message",
            icon: Trash2,
            danger: true,
            onSelect: () => props.onDelete(message),
          },
        ]
      : [],
  ];
  const active = hovered || barMenu || pickerOpen || Boolean(menuAt);
  const failed = message.local_delivery_state === "failed";
  return (
    <div
      role="article"
      id={`message-${message.id}`}
      tabIndex={0}
      aria-label={`Message from ${message.sender_name}`}
      data-flx-action-bar=""
      data-flx-action-bar-active={
        active && !editingThis && !message.local_delivery_state ? "" : undefined
      }
      className={cx(
        m.message,
        grouped && m.messageGrouped,
        active && m.messageHovered,
        mentionsMe && m.messageMentioned,
        editingThis && m.messageEditing,
        menuAt && m.contextMenuActive,
      )}
      onMouseEnter={(event) => {
        setHovered(true);
        setShift(event.shiftKey);
      }}
      onMouseMove={(event) => event.shiftKey !== shift && setShift(event.shiftKey)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest("a, img, video")) return;
        event.preventDefault();
        setMenuAt({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className={m.focusRingAnchor} />
      {message.reply_to_message_id ? (
        <ReplyPreview
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
      ) : null}
      <div className={m.messageContent}>
        {grouped ? null : (
          <h3 className={m.messageAuthorInfo}>
            <span className={m.messageAuthorRow}>
              <span className={m.messageAuthorPart}>
                <span className={m.messageAuthorName}>
                  <span
                    className={m.messageUsername}
                    role="button"
                    style={color ? { color } : undefined}
                  >
                    {message.sender_name}
                  </span>
                </span>
                {agent ? (
                  <span className={cx(tag.tag, tag.tagSm, m.userTagOffset)}>
                    <span className={cx(tag.text, tag.textSm)}>Agent</span>
                  </span>
                ) : null}
              </span>
              <span className={cx(m.messageTimestamp, stamp.container)}>
                <FluxerTooltip content={fullDateTime.format(new Date(message.created_at))}>
                  <time dateTime={message.created_at}>
                    <i className={stamp.hiddenSpacer}> </i>
                    <span className={m.authorDashSeparator} aria-hidden>
                      {" — "}
                    </span>
                    {relativeStamp(message.created_at)}
                  </time>
                </FluxerTooltip>
              </span>
            </span>
          </h3>
        )}
        {editingThis ? (
          <EditInput
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
          <div
            className={cx(
              m.messageText,
              failed
                ? m.messageFailed
                : message.local_delivery_state === "sending"
                  ? m.messageSending
                  : m.messageSent,
            )}
          >
            <div className={cx(markup.markup, "markup")} dir="auto">
              {message.content.map((span, index) => (
                <Span key={index} span={span} jumbo={jumbo} plainMentions={agent} />
              ))}
              {message.edited_at ? (
                <span className={m.editedTimestamp}>
                  <FluxerTooltip content={fullDateTime.format(new Date(message.edited_at))}>
                    <time dateTime={message.edited_at}>
                      <span className={m.editedLabel}> (edited)</span>
                    </time>
                  </FluxerTooltip>
                </span>
              ) : null}
            </div>
          </div>
        )}
        {editingThis ? null : <LinkPreviews text={messageTextForLinks(message.content)} />}
      </div>
      <div className={m.messageGutterLeft} />
      {grouped ? (
        <span className={cx(m.messageTimestampHover, stamp.container)}>
          <time dateTime={message.created_at}>
            <i className={stamp.hiddenSpacer}> </i>
            <span className={m.textSeparator}>[</span>
            {time.format(new Date(message.created_at))}
            <span className={m.textSeparator}>]</span>
          </time>
        </span>
      ) : (
        <div className={m.messageAvatar}>
          {agent ? (
            <span
              style={{
                display: "flex",
                width: 40,
                height: 40,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                backgroundColor: "var(--background-secondary-alt)",
              }}
            >
              <AgentMark agentId={message.sender_agent_id} />
            </span>
          ) : (
            <FluxerAvatar
              id={message.sender_user_id || message.sender_name}
              name={message.sender_name}
              size={40}
              src={avatarUrl || undefined}
            />
          )}
        </div>
      )}
      <div className={m.messageGutterRight} />
      <div className={m.container}>
        {replyCount > 0 ? (
          <button
            type="button"
            className={reactions.reactionPickerButton}
            style={{
              justifySelf: "start",
              fontSize: 14,
              fontWeight: 600,
              gap: 6,
              color: "var(--text-link)",
            }}
            onClick={() => useChatSidePanel.getState().openThread(message.id)}
          >
            <MessagesSquare size={16} />
            {`${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
          </button>
        ) : null}
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
        <Reactions message={message} canWrite={props.canWrite} onToggle={react} />
      </div>
      {!editingThis && !message.local_delivery_state && (active || hovered) ? (
        <ActionBar
          shift={shift}
          canWrite={props.canWrite}
          canEdit={canEdit}
          canDelete={canDelete}
          threadable={!message.local_delivery_state}
          reacted={(emoji) =>
            message.reactions?.some(
              (reaction) => reaction.emoji === emoji && reaction.reacted_by_me,
            ) ?? false
          }
          onReact={react}
          pickerOpen={pickerOpen}
          onPickerOpen={setPickerOpen}
          onReply={() => props.onReply(message.id)}
          onEdit={() => requestAnimationFrame(() => props.onBeginEditing(message))}
          onThread={() => useChatSidePanel.getState().openThread(message.id)}
          onDelete={() => props.onDelete(message)}
          moreRef={moreRef}
          onMore={() => setBarMenu(true)}
        />
      ) : null}
      {failed && onRetry ? (
        <div
          className={cx(bar.actionBarContainer)}
          style={{ opacity: 1, visibility: "visible", pointerEvents: "auto" }}
        >
          <div className={bar.actionBar} role="toolbar" aria-label="Message actions">
            <BarButton label="Retry" icon={RefreshCw} onClick={() => onRetry(message)} />
            {canDelete ? (
              <BarButton
                label="Delete"
                icon={Trash2}
                danger
                onClick={() => props.onDelete(message)}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      <FluxerMenu
        label="Message actions"
        open={barMenu || Boolean(menuAt)}
        onOpenChange={(open) => {
          if (open) return;
          setBarMenu(false);
          setMenuAt(null);
        }}
        anchor={menuAt ?? moreRef}
        side={menuAt ? "right" : "left"}
        groups={menuGroups}
        top={
          props.canWrite ? (
            <QuickReactionsRow
              onReact={(emoji) => {
                setBarMenu(false);
                setMenuAt(null);
                react(emoji);
              }}
            />
          ) : undefined
        }
      />
    </div>
  );
}

function messageTextForLinks(spans: MessageSpan[]): string {
  return spans
    .map((span) => (span.type === "text" ? span.text : span.type === "link" ? ` ${span.url} ` : ""))
    .join("");
}

/** A span of a message: words with Twemoji, a link, or a mention as Fluxer draws one. */
function Span(props: { span: MessageSpan; jumbo: boolean; plainMentions: boolean }) {
  const { span } = props;
  if (span.type === "text") {
    if (!props.plainMentions) return <TwemojiText text={span.text} jumbo={props.jumbo} />;
    return span.text
      .split(/(@[\p{L}\p{N}_.'’-]+(?:\s+[\p{Lu}][\p{L}\p{N}_.'’-]*){0,2})/gu)
      .map((part, index) =>
        part.startsWith("@") ? (
          <span key={index} className={markup.mention}>
            {part}
          </span>
        ) : (
          <TwemojiText key={index} text={part} />
        ),
      );
  }
  if (span.type === "link")
    return (
      <Link className={markup.link} to={span.url}>
        {span.label}
      </Link>
    );
  if ("role_id" in span) return <RoleMention roleId={span.role_id} label={span.label} />;
  return <span className={cx(markup.mention, markup.interactive)}>{`@${span.label}`}</span>;
}

/** A role mention: the role's color, its 10% fill and a 30% inset ring (MentionRenderer). */
function RoleMention(props: { roleId: string; label: string }) {
  const role = useSpaceRolesStore((state) => {
    for (const roles of Object.values(state.bySpace)) {
      const found = roles.find((item) => item.id === props.roleId);
      if (found) return found;
    }
    return undefined;
  });
  const hex = role?.color && /^#[0-9a-f]{6}$/i.test(role.color) ? role.color : undefined;
  const rgb = hex
    ? [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)).join(", ")
    : undefined;
  return (
    <span
      className={markup.mention}
      style={
        rgb
          ? ({
              "--mention-color": `rgb(${rgb})`,
              color: `rgb(${rgb})`,
              backgroundColor: `rgba(${rgb}, 0.1)`,
              boxShadow: `inset 0 0 0 1px rgba(${rgb}, 0.3)`,
            } as CSSProperties)
          : undefined
      }
    >
      {`@${role?.name ?? props.label}`}
    </span>
  );
}

/** ReplyPreview: the curved spine from the avatar, a 16px face, the name, one line of text. */
function ReplyPreview(props: {
  replied: SpaceMessage | undefined;
  avatarUrl: string;
  color?: string;
  earlier: boolean;
  onOpen(): void;
}) {
  const { replied } = props;
  if (!replied)
    return (
      <div className={m.repliedMessage}>
        <div className={m.repliedIconContainer}>
          <Reply className={m.repliedIcon} />
        </div>
        <button
          type="button"
          className={cx(m.repliedTextPreview, m.unstyled, m.repliedItalic)}
          onClick={props.onOpen}
        >
          {props.earlier ? "Click to see the original message" : "Original message was deleted"}
        </button>
      </div>
    );
  const preview = messageReplyPreviewText(replied);
  return (
    <div className={m.repliedMessage}>
      <span className={m.repliedAvatar}>
        <FluxerAvatar
          id={replied.sender_user_id || replied.sender_name}
          name={replied.sender_name}
          size={16}
          src={props.avatarUrl || undefined}
        />
      </span>
      <span
        className={m.repliedUsername}
        style={
          props.color ? ({ "--replied-username-color": props.color } as CSSProperties) : undefined
        }
      >
        {`@${replied.sender_name}`}
      </span>
      <button
        type="button"
        className={cx(m.repliedTextPreview, m.unstyled, !preview && m.repliedItalic)}
        onClick={props.onOpen}
      >
        <span className={cx(m.repliedTextContent, markup.markup, "markup")}>
          {preview ? <TwemojiText text={preview} /> : "Message contains attached media"}
        </span>
      </button>
    </div>
  );
}

/** MessageReactions: 30px pills with a 20px Twemoji and the count, then the add button. */
function Reactions(props: {
  message: SpaceMessage;
  canWrite: boolean;
  onToggle(emoji: string): void;
}) {
  const [picker, setPicker] = useState(false);
  const shown = (props.message.reactions ?? []).filter((reaction) => reaction.count > 0);
  if (!shown.length) return null;
  return (
    <div className={cx(reactions.reactionsGrid, reactions.uniformRows)}>
      {shown.map((reaction) => (
        <div
          key={reaction.emoji}
          className={cx(
            reactions.reactionContainer,
            reaction.reacted_by_me && reactions.reactionMe,
            !props.canWrite && reactions.reactionContainerDisabled,
          )}
        >
          <button
            type="button"
            aria-pressed={reaction.reacted_by_me === true}
            aria-label={`${reaction.emoji}, ${reaction.count} ${reaction.count === 1 ? "reaction" : "reactions"}`}
            disabled={!props.canWrite}
            className={reactions.reactionButton}
            onClick={() => props.onToggle(reaction.emoji)}
          >
            <div className={reactions.reactionInner}>
              <Twemoji emoji={reaction.emoji} className={reactions.emoji} />
              <div className={reactions.countWrapper}>{reaction.count}</div>
            </div>
          </button>
        </div>
      ))}
      {props.canWrite ? (
        <FluxerEmojiPicker
          side="right"
          align="start"
          onSelect={props.onToggle}
          onOpenChange={setPicker}
        >
          <button
            type="button"
            aria-label="Add reaction"
            className={cx(
              reactions.reactionPickerButton,
              picker && reactions.reactionPickerButtonActive,
            )}
          >
            <Smile size={20} />
          </button>
        </FluxerEmojiPicker>
      ) : null}
    </div>
  );
}

function BarButton(props: {
  label: string;
  icon?: LucideIcon;
  emoji?: string;
  danger?: boolean;
  active?: boolean;
  onClick(): void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const Glyph = props.icon;
  return (
    <FluxerTooltip content={props.label}>
      <button
        ref={props.buttonRef}
        type="button"
        aria-label={props.label}
        className={cx(bar.button, props.danger && bar.danger, props.active && bar.active)}
        onClick={props.onClick}
      >
        {props.emoji ? (
          <Twemoji emoji={props.emoji} className={bar.emojiImage} />
        ) : Glyph ? (
          <span className={bar.actionBarIcon}>
            <Glyph />
          </span>
        ) : null}
      </button>
    </FluxerTooltip>
  );
}

/** MessageActionBar: three quick reactions, add reaction, edit or reply, thread, more (or delete). */
function ActionBar(props: {
  shift: boolean;
  canWrite: boolean;
  canEdit: boolean;
  canDelete: boolean;
  threadable: boolean;
  reacted(emoji: string): boolean;
  onReact(emoji: string): void;
  pickerOpen: boolean;
  onPickerOpen(open: boolean): void;
  onReply(): void;
  onEdit(): void;
  onThread(): void;
  onDelete(): void;
  moreRef: RefObject<HTMLButtonElement | null>;
  onMore(): void;
}) {
  const frequent = useFrequentEmoji((state) => state.value);
  const quick = [...frequent, ...DEFAULT_QUICK]
    .filter((emoji, index, all) => all.indexOf(emoji) === index)
    .slice(0, 3);
  return (
    <div className={bar.actionBarContainer}>
      <div className={bar.actionBar} role="toolbar" aria-label="Message actions">
        {props.canWrite && !props.shift
          ? quick.map((emoji) => (
              <BarButton
                key={emoji}
                label={`React with ${emoji}`}
                emoji={emoji}
                active={props.reacted(emoji)}
                onClick={() => props.onReact(emoji)}
              />
            ))
          : null}
        {props.canWrite ? (
          <FluxerEmojiPicker
            side="left"
            align="start"
            open={props.pickerOpen}
            onSelect={props.onReact}
            onOpenChange={props.onPickerOpen}
          >
            <button
              type="button"
              aria-label="Add reaction"
              className={cx(bar.button, props.pickerOpen && bar.active)}
            >
              <span className={bar.actionBarIcon}>
                <Smile />
              </span>
            </button>
          </FluxerEmojiPicker>
        ) : null}
        {props.canEdit ? (
          <BarButton label="Edit" icon={Pencil} onClick={props.onEdit} />
        ) : props.canWrite ? (
          <BarButton label="Reply" icon={Reply} onClick={props.onReply} />
        ) : null}
        {props.shift && props.canEdit && props.canWrite ? (
          <BarButton label="Reply" icon={Reply} onClick={props.onReply} />
        ) : null}
        {props.threadable ? (
          <BarButton label="Create thread" icon={MessagesSquare} onClick={props.onThread} />
        ) : null}
        {props.shift && props.canDelete ? (
          <BarButton label="Delete" icon={Trash2} danger onClick={props.onDelete} />
        ) : (
          <BarButton
            label="More"
            icon={Ellipsis}
            buttonRef={props.moreRef}
            onClick={props.onMore}
          />
        )}
      </div>
    </div>
  );
}

/** QuickReactionsRow at the top of the message menu: square tiles of the quick emoji. */
function QuickReactionsRow(props: { onReact(emoji: string): void }) {
  const frequent = useFrequentEmoji((state) => state.value);
  const quick = [...frequent, ...DEFAULT_QUICK, "❤️"]
    .filter((emoji, index, all) => all.indexOf(emoji) === index)
    .slice(0, 4);
  return (
    <div className={menu.quickReactionsGroup}>
      {quick.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`React with ${emoji}`}
          className={menu.quickReactionItem}
          onClick={() => props.onReact(emoji)}
        >
          <Twemoji emoji={emoji} className={menu.emojiSubmenuImg} />
        </button>
      ))}
    </div>
  );
}

/** EditingMessageInput: the bordered box in place of the text, and "Escape to cancel • Enter to save". */
function EditInput(props: {
  message: SpaceMessage;
  text: string;
  saving: boolean;
  onText(value: string): void;
  onCancel(messageId: string): void;
  onSubmit(event: FormEvent, message: SpaceMessage): void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = area.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, window.innerHeight / 2)}px`;
  }, [props.text]);
  return (
    <form ref={form} onSubmit={(event) => props.onSubmit(event, props.message)}>
      <div className={textarea.textareaContainer}>
        <div className={textarea.mainWrapperEditing}>
          <div className={cx(textarea.contentAreaEditing, editing.editor)}>
            <textarea
              ref={area}
              autoFocus
              rows={1}
              maxLength={4000}
              aria-label="Edit message"
              value={props.text}
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
              style={{
                width: "100%",
                resize: "none",
                border: "none",
                background: "transparent",
                padding: 0,
                outline: "none",
                color: "var(--text-chat)",
                fontSize: "var(--textarea-font-size)",
                lineHeight: "var(--textarea-line-height)",
                minHeight: "var(--textarea-line-height)",
              }}
            />
          </div>
        </div>
      </div>
      <div className={editing.footer}>
        <span>
          {"Escape to "}
          <button
            type="button"
            className={editing.footerLink}
            style={{ border: "none", background: "none", padding: 0, font: "inherit" }}
            disabled={props.saving}
            onClick={() => props.onCancel(props.message.id)}
          >
            cancel
          </button>
          <span className={editing.separator} />
          {"Enter to "}
          <button
            type="submit"
            className={editing.footerLink}
            style={{ border: "none", background: "none", padding: 0, font: "inherit" }}
            disabled={props.saving || !props.text.trim()}
          >
            save
          </button>
        </span>
      </div>
    </form>
  );
}
