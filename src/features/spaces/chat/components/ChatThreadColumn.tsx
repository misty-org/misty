import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { SpaceMessage } from "@/api/spaces/dto/entities";
import { IconButton, Textarea } from "@/shared/ui";
import { formatChatMessageTime } from "./ChatDisplay";
import { threadRootOf } from "./messageHelpers";
import { useChatSidePanel } from "../store/chatSidePanelStore";

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
        <strong className="text-sm text-cream">{message.sender_name}</strong>
        <time className="text-[11px] tabular-nums text-cream-muted">
          {formatChatMessageTime(message.created_at)}
        </time>
      </div>
      <p className="m-0 whitespace-pre-wrap text-sm leading-5 text-cream/90 [overflow-wrap:anywhere]">
        {plain(message)}
      </p>
    </li>
  );
  return (
    <aside
      aria-label="Replies"
      className="flex w-[min(360px,40%)] shrink-0 flex-col border-l border-charcoal-border bg-charcoal-bg"
    >
      <header className="flex min-h-11 items-center gap-2 border-b border-charcoal-border px-3 py-1.5">
        <h2 className="m-0 min-w-0 flex-1 text-sm font-medium text-cream-bright">Replies</h2>
        <IconButton
          label="Close replies"
          size="xs"
          onClick={() => useChatSidePanel.getState().closeThread()}
        >
          <X />
        </IconButton>
      </header>
      <ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
        {root ? (
          <>
            {entry(root)}
            <li aria-hidden className="mx-3 my-1 border-t border-charcoal-border" />
          </>
        ) : (
          <li className="p-3 text-sm text-cream-muted">This message is no longer here.</li>
        )}
        {replies.map((message) => entry(message))}
      </ol>
      {canWrite && root ? (
        <form onSubmit={submit} className="border-t border-charcoal-border p-3">
          {typingLabel ? (
            <p
              className="m-0 mb-1 min-h-4 text-xs text-cream-muted"
              role="status"
              aria-live="polite"
            >
              {typingLabel}
            </p>
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
    </aside>
  );
}
