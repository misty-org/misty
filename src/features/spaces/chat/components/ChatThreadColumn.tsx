import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { SpaceMessage } from "../../api/dto/entities";
import { IconButton, Separator, Surface, Text, Textarea } from "@/shared/ui";
import { formatChatMessageTime } from "./ChatDisplay";
import { threadRootOf } from "./messageText";
import { useChatSidePanel } from "../chatSidePanelStore";

const plain = (message: SpaceMessage) =>
  message.content
    .map((span) =>
      span.type === "text" ? span.text : span.type === "link" ? span.label : `@${span.label}`,
    )
    .join("");

/**
 * A message and every reply under it, docked beside the chat as in Slack. Threads are flat: a reply
 * to a reply joins the same thread.
 */
export function ChatThreadColumn({
  rootId,
  messages,
  canWrite,
  typingLabel,
  onTypingInput,
  onStopTyping,
  onSend,
}: {
  rootId: string;
  messages: SpaceMessage[];
  canWrite: boolean;
  typingLabel: string;
  onTypingInput: (text: string) => void;
  onStopTyping: () => void;
  onSend(replyToMessageId: string, text: string): Promise<void>;
}) {
  const [text, setText] = useState("");
  const root = messages.find((message) => message.id === rootId);
  const byId = new Map(messages.map((message) => [message.id, message]));
  // Flat, as in Slack: every reply in the chain under this message, oldest first.
  const replies = messages.filter(
    (message) => message.id !== rootId && threadRootOf(message, byId) === rootId,
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text;
    if (!value.trim()) return;
    setText("");
    onStopTyping();
    void onSend(rootId, value);
  };
  const entry = (message: SpaceMessage) => (
    <li key={message.id} className="px-3 py-2">
      <div className="flex items-baseline gap-2">
        <Text bare as="strong" tone="default" className="text-sm">
          {message.sender_name}
        </Text>
        <Text bare as="time" tone="muted" className="text-2xs tabular-nums">
          {formatChatMessageTime(message.created_at)}
        </Text>
      </div>
      <Text
        bare
        as="p"
        tone="default"
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
      aria-label="Replies"
      className="flex w-[min(360px,40%)] shrink-0 flex-col border-l"
    >
      <header className="flex min-h-12 items-center gap-2 border-b px-3 py-1.5">
        <Text bare as="h2" tone="bright" className="m-0 min-w-0 flex-1 text-sm font-medium">
          Replies
        </Text>
        <IconButton
          label="Close replies"
          size="sm"
          onClick={() => useChatSidePanel.getState().closeThread()}
        >
          <X />
        </IconButton>
      </header>
      <ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
        {root ? (
          <>
            {entry(root)}
            <li aria-hidden className="mx-3 my-1">
              <Separator />
            </li>
          </>
        ) : (
          <Text bare as="li" tone="muted" className="p-3 text-sm">
            This message is no longer here.
          </Text>
        )}
        {replies.map((message) => entry(message))}
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
