import { useLayoutEffect, useMemo, useRef, type FormEvent, type ReactNode } from "react";
import { Hash, Lock } from "lucide-react";
import { ChannelDivider, ChannelWelcome } from "@misty/ui";
import { SystemErrorNotice } from "@/shared/platform/system_errors";
import type { SpaceMessage } from "../../api/dto/entities";
import type { SpaceChatMessagesProps } from "./ChatMessages";
import { buildChatDisplayRows, useMemberAvatarUrls } from "./ChatDisplay";
import { DirectMessageIntro } from "./DirectMessageIntro";
import { ChatStarters } from "./ChatStarters";
import { ChatMessagesLoading } from "./ChatMessagesLoading";
import { MessageRow } from "./ChatMessageRow";
import { AgentWorkLine } from "./AgentWorkLine";

const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

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
  const latestByAgent = useMemo(() => {
    const latest = new Map<string, string>();
    for (const message of props.messages)
      if (message.sender_kind === "agent" && message.sender_agent_id && message.sender_user_id)
        latest.set(`${message.sender_user_id}:${message.sender_agent_id}`, message.id);
    return new Set(latest.values());
  }, [props.messages]);
  const atStart = !props.hasOlderMessages || !props.messages.length;
  const quiet =
    !props.messages.length && !props.loading && Boolean(props.welcome || props.directRecipient);
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
    if (latestByAgent.has(message.id) && message.sender_agent_id)
      stream.push(
        <AgentWorkLine
          key={`work:${message.id}`}
          spaceId={props.spaceId}
          userId={message.sender_user_id}
          agentId={message.sender_agent_id}
        />,
      );
  }
  return (
    <div
      ref={props.scrollRef}
      onScroll={props.onScroll}
      className="misty-scrollbar-flush flex min-h-0 flex-1 flex-col overflow-y-auto [overflow-anchor:none]"
    >
      <div
        role="log"
        aria-label="Messages"
        className={`${quiet ? "my-auto" : "mt-auto"} flex min-w-0 flex-col pt-4 pb-6`}
      >
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
            {!atStart ? null : props.welcome ? (
              <div className="px-4">{props.welcome}</div>
            ) : props.directRecipient ? (
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
      onReload: () => latest.current.onReload(),
      onJumpToMessage: (messageId: string) => latest.current.onJumpToMessage?.(messageId),
    }),
    [],
  );
  return { ...props, ...handlers, onRetry: props.onRetry ? handlers.onRetry : undefined };
}
