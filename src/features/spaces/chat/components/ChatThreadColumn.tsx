import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, X } from "lucide-react";
import type { SpaceMessage } from "../../api/dto/entities";
import { IconButton, PaneLoading, Separator, Surface, Text, Textarea } from "@misty/ui";
import { formatChatMessageTime } from "./ChatDisplay";
import { useChatSidePanel } from "../chatSidePanelStore";

const plain = (message: SpaceMessage) =>
  message.content
    .map((span) =>
      span.type === "text" ? span.text : span.type === "link" ? span.label : `@${span.label}`,
    )
    .join("");

/**
 * A thread, in a panel to the right of the chat as in Slack and Discord: the message it hangs from, how
 * many replies it has, the replies oldest first, and a box to reply. A reply sent here is the thread's;
 * it never appears in the channel itself.
 */
export function ChatThreadColumn({
  root,
  replies,
  loading,
  loadingOlder,
  hasOlder,
  error,
  canWrite,
  typingLabel,
  channelName,
  onTypingInput,
  onStopTyping,
  onLoadOlder,
  onSend,
}: {
  /** The message the thread hangs from; none when it is no longer there. */
  root: SpaceMessage | undefined;
  replies: SpaceMessage[];
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  error: string;
  canWrite: boolean;
  typingLabel: string;
  /** The chat the thread is in, named in the header. */
  channelName: string;
  onTypingInput: (text: string) => void;
  onStopTyping: () => void;
  onLoadOlder: () => Promise<boolean>;
  onSend(text: string): Promise<void>;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const pagingRef = useRef(false);
  const fromList = useChatSidePanel((panel) => panel.threadFromList);
  // A new reply scrolls into view, as in a chat.
  const latestReplyId = replies.at(-1)?.id;
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
  const entry = (message: SpaceMessage) => (
    <li
      key={message.id}
      data-message-id={message.id}
      className="px-3 py-2"
      data-delivery={message.local_delivery_state}
    >
      <div className="flex items-baseline gap-2">
        <Text bare as="strong" tone="default" className="text-sm">
          {message.sender_name}
        </Text>
        <Text bare as="time" tone="muted" className="text-2xs tabular-nums">
          {formatChatMessageTime(message.created_at)}
        </Text>
        {message.local_delivery_state === "failed" ? (
          <Text bare tone="failed" className="text-2xs">
            Not sent
          </Text>
        ) : null}
      </div>
      <Text
        bare
        as="p"
        tone={message.local_delivery_state === "sending" ? "muted" : "default"}
        className="m-0 whitespace-pre-wrap text-sm leading-5 [overflow-wrap:anywhere]"
      >
        {plain(message)}
      </Text>
    </li>
  );
  return (
    <Surface
      as="aside"
      tone="page"
      aria-label="Thread"
      className="flex w-[min(22.5rem,40%)] shrink-0 flex-col"
    >
      <header className="flex min-h-12 items-center gap-2 border-b px-3 py-1.5">
        {fromList ? (
          <IconButton
            label="Back to threads"
            size="sm"
            onClick={() => useChatSidePanel.getState().openThreadsList()}
          >
            <ArrowLeft />
          </IconButton>
        ) : null}
        <Text bare as="h2" tone="bright" className="m-0 min-w-0 flex-1 text-sm font-medium">
          Thread
          <Text bare tone="muted" className="ml-2 font-normal">
            {channelName}
          </Text>
        </Text>
        <IconButton
          label="Close thread"
          size="sm"
          onClick={() => useChatSidePanel.getState().closeThread()}
        >
          <X />
        </IconButton>
      </header>
      <ol
        ref={listRef}
        onScroll={() => void loadOlderFromTop()}
        className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0 [overflow-anchor:none]"
      >
        {root ? (
          <>
            {entry(root)}
            <li className="flex items-center gap-3 px-3 py-1">
              <Text bare tone="muted" className="shrink-0 text-xs">
                {(root.reply_count ?? replies.length) === 1
                  ? "1 reply"
                  : `${root.reply_count ?? replies.length} replies`}
              </Text>
              <Separator className="flex-1" />
            </li>
          </>
        ) : (
          <Text bare as="li" tone="muted" className="p-3 text-sm">
            This message is no longer here.
          </Text>
        )}
        {loadingOlder ? (
          <li>
            <PaneLoading label="Loading older replies" inline />
          </li>
        ) : null}
        {loading && replies.length === 0 ? (
          <li>
            <PaneLoading label="Loading replies" inline />
          </li>
        ) : null}
        {replies.map((message) => entry(message))}
        {error && !loading ? (
          <Text bare as="li" tone="failed" className="p-3 text-sm">
            {error}
          </Text>
        ) : null}
      </ol>
      {canWrite && root ? (
        <form onSubmit={submit} className="border-t p-3">
          {typingLabel ? (
            <Text
              as="p"
              tone="muted"
              className="m-0 mb-1 min-h-4 text-xs"
              role="status"
              aria-live="polite"
            >
              {typingLabel}
            </Text>
          ) : null}
          <Textarea
            aria-label="Reply"
            rows={2}
            value={text}
            placeholder="Reply…"
            onChange={(event) => {
              setText(event.target.value);
              onTypingInput(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            className="min-h-0 resize-none"
          />
        </form>
      ) : null}
    </Surface>
  );
}
