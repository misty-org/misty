import { aiSurfaceApi } from "@/features/ai-surface/api";
import type { GlobalAiMessage } from "@/features/global-search/types";
import { IconButton } from "@/shared/ui";
import {
  Check,
  Copy,
  PencilLine,
  RefreshCw,
  Reply,
  RotateCcw,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The row under each message, revealed on hover or focus. Answers share one set of actions
 * whether they finished or failed; Try again joins them only on a retryable failure.
 */
export function AgentMessageActions(props: {
  message: GlobalAiMessage;
  /** The message text as shown, without private context envelopes. */
  text: string;
  working: boolean;
  retryPrompt?: string;
  /** The prompt can be sent again as typed: no attachments or private context. */
  resendable?: boolean;
  onRetry: (prompt: string) => void;
  onEdit?: (text: string) => void;
  onReply?: (quote: string) => void;
}) {
  const { message } = props;
  const state = message.state ?? "completed";
  if (state === "pending" || state === "streaming") return null;
  const user = message.role === "user";
  const canRetry = state === "failed" && message.retryable && props.retryPrompt;
  return (
    <div className="agent-message-actions" data-align={user ? "end" : "start"}>
      {props.text ? <CopyAction text={props.text} /> : null}
      {user && props.onEdit ? (
        <Action label="Edit as new message" onClick={() => props.onEdit?.(props.text)}>
          <PencilLine />
        </Action>
      ) : null}
      {user && props.resendable ? (
        <Action
          label="Ask again"
          disabled={props.working}
          onClick={() => props.onRetry(props.text)}
        >
          <RefreshCw />
        </Action>
      ) : null}
      {!user && props.onReply && props.text ? (
        <Action
          label="Reply"
          onClick={(event) => props.onReply?.(selectedText(event.currentTarget) || props.text)}
        >
          <Reply />
        </Action>
      ) : null}
      {!user && message.invocationId ? (
        <FeedbackActions invocationId={message.invocationId} />
      ) : null}
      {!user && props.text ? <ReadAloudAction text={props.text} /> : null}
      {canRetry ? (
        <Action
          label="Try again"
          disabled={props.working}
          onClick={() => props.onRetry(props.retryPrompt!)}
        >
          <RotateCcw />
        </Action>
      ) : null}
      <MessageTime value={message.createdAt} />
    </div>
  );
}

/** Text the person highlighted inside this answer, so Reply can quote just that part. */
function selectedText(button: HTMLElement) {
  const selection = window.getSelection();
  const message = button.closest(".agent-message-assistant");
  if (!selection || selection.isCollapsed || !message) return "";
  const range = selection.getRangeAt(0);
  return message.contains(range.commonAncestorContainer) ? selection.toString().trim() : "";
}

function Action(props: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <IconButton
      size="xs"
      label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </IconButton>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Action
      label={copied ? "Copied" : "Copy"}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
    >
      {copied ? <Check /> : <Copy />}
    </Action>
  );
}

/** Ratings go to the invocation's feedback record; a failed send returns to unrated. */
function FeedbackActions({ invocationId }: { invocationId: string }) {
  const [rating, setRating] = useState<-1 | 1>();
  const rate = (value: -1 | 1) => {
    if (rating === value) return;
    const previous = rating;
    setRating(value);
    void aiSurfaceApi.feedback(invocationId, value).catch(() => setRating(previous));
  };
  return (
    <>
      <Action label="Good response" pressed={rating === 1} onClick={() => rate(1)}>
        <ThumbsUp fill={rating === 1 ? "currentColor" : "none"} />
      </Action>
      <Action label="Bad response" pressed={rating === -1} onClick={() => rate(-1)}>
        <ThumbsDown fill={rating === -1 ? "currentColor" : "none"} />
      </Action>
    </>
  );
}

function ReadAloudAction({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  // Only this message's own utterance is stopped on unmount, never another message's.
  const utterance = useRef<SpeechSynthesisUtterance>(undefined);
  const speech = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  useEffect(
    () => () => {
      if (utterance.current) speech?.cancel();
    },
    [speech],
  );
  if (!speech) return null;
  return (
    <Action
      label={speaking ? "Stop reading" : "Read aloud"}
      onClick={() => {
        speech.cancel();
        if (speaking) return setSpeaking(false);
        const next = new SpeechSynthesisUtterance(plainText(text));
        next.onend = next.onerror = () => {
          if (utterance.current === next) utterance.current = undefined;
          setSpeaking(false);
        };
        utterance.current = next;
        speech.speak(next);
        setSpeaking(true);
      }}
    >
      {speaking ? <Square /> : <Volume2 />}
    </Action>
  );
}

function MessageTime({ value }: { value: string }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time className="agent-message-time" dateTime={value} title={fullFormat.format(date)}>
      {timeFormat.format(date)}
    </time>
  );
}

/** Speech reads prose, not Markdown punctuation. */
function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1");
}
