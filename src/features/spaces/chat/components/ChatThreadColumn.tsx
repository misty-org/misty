import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { ArrowLeft, RefreshCw, Smile, X } from "lucide-react";
import type { SpaceMessage } from "../../api/dto/entities";
import {
  Avatar,
  AvatarFallback,
  ChannelDivider,
  ChannelMessage,
  ChannelMessageText,
  FramedBar,
  IconButton,
  MessageComposer,
  MessageComposerSend,
  PaneLoading,
  Text,
  TypingLine,
} from "@misty/ui";
import { AgentMark } from "@/features/agents";
import {
  buildChatDisplayRows,
  memberOutlineFor,
  useMemberAvatarUrls,
  useMemberOutlines,
} from "./ChatDisplay";
import { ChatAvatar } from "./ChatAvatar";
import { Span } from "./ChatMessageParts";
import { isAgentAuthoredMessage } from "./message_text";
import { useChatSidePanel } from "../chat_side_panel_store";
import { ChatEmojiPicker } from "../emoji/ChatEmojiPicker";

const MAX_REPLY_LENGTH = 3000;

const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const fullDateTime = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

export function ChatThreadHeader({ channelName }: { channelName: string }) {
  const fromList = useChatSidePanel((panel) => panel.threadFromList);
  return (
    <FramedBar
      start={
        <>
          {fromList ? (
            <IconButton
              label="Back to threads"
              onClick={() => useChatSidePanel.getState().openThreadsList()}
            >
              <ArrowLeft />
            </IconButton>
          ) : null}
          <Text as="h2" size="control" weight="semibold" tone="bright" className="min-w-0 shrink">
            Thread
          </Text>
          <Text size="control" tone="muted" className="min-w-0 flex-1">
            {channelName}
          </Text>
        </>
      }
    >
      <IconButton label="Close thread" onClick={() => useChatSidePanel.getState().closeThread()}>
        <X />
      </IconButton>
    </FramedBar>
  );
}

export function ChatThreadColumn({
  spaceId,
  root,
  replies,
  loading,
  loadingOlder,
  hasOlder,
  error,
  canWrite,
  typingLabel,
  channelName,
  memberColors,
  onTypingInput,
  onStopTyping,
  onLoadOlder,
  onSend,
  onRetry,
}: {
  spaceId: string;
  root: SpaceMessage | undefined;
  replies: SpaceMessage[];
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  error: string;
  canWrite: boolean;
  typingLabel: string;
  channelName: string;
  memberColors?: Map<string, string>;
  onTypingInput: (text: string) => void;
  onStopTyping: () => void;
  onLoadOlder: () => Promise<boolean>;
  onSend(text: string): Promise<void>;
  onRetry?: (message: SpaceMessage) => void;
}) {
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const pagingRef = useRef(false);
  const latestReplyId = replies.at(-1)?.id;
  const everyone = useMemo(() => (root ? [root, ...replies] : replies), [root, replies]);
  const avatars = useMemberAvatarUrls(spaceId, everyone);
  const outlines = useMemberOutlines(spaceId, everyone);
  const rows = useMemo(() => buildChatDisplayRows(everyone), [everyone]);
  const replyRows = root ? rows.slice(1) : rows;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [latestReplyId]);
  const loadOlderFromTop = async () => {
    const list = listRef.current;
    if (!list || !hasOlder || loadingOlder || pagingRef.current || list.scrollTop > 72) return;
    pagingRef.current = true;
    try {
      await onLoadOlder();
    } finally {
      pagingRef.current = false;
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text;
    if (!value.trim()) return;
    setText("");
    onStopTyping();
    void onSend(value);
  };
  const focusEnd = () =>
    requestAnimationFrame(() => {
      const area = textarea.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    });
  const entry = (message: SpaceMessage, grouped: boolean): ReactNode => {
    const agent = isAgentAuthoredMessage(message);
    const failed = message.local_delivery_state === "failed";
    const avatarUrl = message.origin?.author_avatar_url || avatars.get(message.sender_user_id);
    return (
      <ChannelMessage
        key={message.id}
        data-message-id={message.id}
        data-delivery={message.local_delivery_state}
        name={message.sender_name}
        color={memberColors?.get(message.sender_user_id)}
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
              outline={memberOutlineFor(outlines, message)}
            />
          )
        }
        badge={
          failed ? (
            <Text bare size="caption" tone="failed" className="shrink-0">
              Not sent
            </Text>
          ) : undefined
        }
        time={time.format(new Date(message.created_at))}
        timeFull={fullDateTime.format(new Date(message.created_at))}
        dateTime={message.created_at}
        pending={message.local_delivery_state === "sending"}
        tools={
          failed && onRetry ? (
            <IconButton label="Retry" onClick={() => onRetry(message)}>
              <RefreshCw />
            </IconButton>
          ) : undefined
        }
      >
        <ChannelMessageText failed={failed}>
          {message.content.map((span, index) => (
            <Span key={index} span={span} plainMentions={agent} />
          ))}
        </ChannelMessageText>
      </ChannelMessage>
    );
  };
  const replyCount = root ? (root.reply_count ?? replies.length) : 0;
  return (
    <section aria-label="Thread" className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={() => void loadOlderFromTop()}
        className="misty-scrollbar-flush min-h-0 flex-1 overflow-y-auto pt-4 [overflow-anchor:none]"
      >
        {root ? (
          <>
            <div className="px-4">
              <ChannelDivider label={longDate.format(new Date(root.created_at))} kind="date" />
            </div>
            {entry(root, false)}
            <div className="px-4">
              <ChannelDivider label={replyCount === 1 ? "1 reply" : `${replyCount} replies`} />
            </div>
          </>
        ) : (
          <Text as="p" size="control" tone="muted" wrap className="m-0 px-4">
            This message is no longer here.
          </Text>
        )}
        {loadingOlder ? <PaneLoading label="Loading older replies" inline /> : null}
        {loading && replies.length === 0 ? <PaneLoading label="Loading replies" inline /> : null}
        {replyRows.map(({ message, compact, dateLabel }, index) => (
          <Fragment key={message.id}>
            {dateLabel && (root || index > 0) ? (
              <div className="px-4">
                <ChannelDivider label={longDate.format(new Date(message.created_at))} kind="date" />
              </div>
            ) : null}
            {entry(message, compact && index > 0)}
          </Fragment>
        ))}
        {error && !loading ? (
          <Text as="p" size="control" tone="failed" wrap className="m-0 px-4 pt-2">
            {error}
          </Text>
        ) : null}
      </div>
      {canWrite && root ? (
        <section aria-label="Reply composer" className="shrink-0 px-4 pb-1">
          <TypingLine label={typingLabel || undefined} />
          <form ref={form} onSubmit={submit}>
            <MessageComposer
              variant="card"
              inputRef={textarea}
              inputProps={{
                "aria-label": "Reply",
                maxLength: MAX_REPLY_LENGTH,
                value: text,
                placeholder: `Reply in ${channelName}`,
                onChange: (event) => {
                  setText(event.target.value);
                  onTypingInput(event.target.value);
                },
                onKeyDown: (event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    form.current?.requestSubmit();
                  }
                },
              }}
              end={
                <>
                  <ChatEmojiPicker
                    side="top"
                    align="end"
                    open={emojiOpen}
                    onOpenChange={setEmojiOpen}
                    onSelect={(emoji) => {
                      setText((current) => current + emoji);
                      focusEnd();
                    }}
                  >
                    <IconButton label="Emoji" aria-pressed={emojiOpen}>
                      <Smile />
                    </IconButton>
                  </ChatEmojiPicker>
                  <MessageComposerSend type="submit" label="Send reply" disabled={!text.trim()} />
                </>
              }
            />
          </form>
        </section>
      ) : null}
    </section>
  );
}
