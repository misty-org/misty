import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, X } from "lucide-react";
import type { SpaceMessage } from "../../api/dto/entities";
import { IconButton, PaneLoading, Separator, Surface, Text, Textarea } from "@misty/ui";
import { formatChatMessageTime } from "./ChatDisplay";
import { useChatSidePanel } from "../chat_side_panel_store";

const plain = (message: SpaceMessage) =>
  message.content
    .map((span) =>
      span.type === "text" ? span.text : span.type === "link" ? span.label : `@${span.label}`,
    )
    .join("");

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
  root: SpaceMessage | undefined;
  replies: SpaceMessage[];
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  error: string;
  canWrite: boolean;
  typingLabel: string;
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
        <Text bare as="strong" size="control" tone="default" weight="medium">
          {message.sender_name}
        </Text>
        <Text bare as="time" size="meta" tone="muted" className="tabular-nums">
          {formatChatMessageTime(message.created_at)}
        </Text>
        {message.local_delivery_state === "failed" ? (
          <Text bare size="meta" tone="failed">
            Not sent
          </Text>
        ) : null}
      </div>
      <Text
        bare
        as="p"
        tone={message.local_delivery_state === "sending" ? "muted" : "default"}
        size="body"
        className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]"
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
      className="flex w-[min(--spacing(90),40%)] shrink-0 flex-col"
    >
      <header className="flex min-h-12 items-center gap-2 border-b px-3 py-1.5">
        {fromList ? (
          <IconButton
            label="Back to threads"
            onClick={() => useChatSidePanel.getState().openThreadsList()}
          >
            <ArrowLeft />
          </IconButton>
        ) : null}
        <Text
          bare
          as="h2"
          size="control"
          tone="bright"
          weight="medium"
          className="m-0 min-w-0 flex-1"
        >
          Thread
          <Text bare tone="muted" weight="regular" className="ml-2">
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
              <Text bare size="meta" tone="muted" className="shrink-0">
                {(root.reply_count ?? replies.length) === 1
                  ? "1 reply"
                  : `${root.reply_count ?? replies.length} replies`}
              </Text>
              <Separator className="flex-1" />
            </li>
          </>
        ) : (
          <Text bare as="li" size="control" tone="muted" className="p-3">
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
          <Text bare as="li" size="control" tone="failed" className="p-3">
            {error}
          </Text>
        ) : null}
      </ol>
      {canWrite && root ? (
        <form onSubmit={submit} className="p-3">
          {typingLabel ? (
            <Text
              as="p"
              size="meta"
              tone="muted"
              className="m-0 mb-1"
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
