import type { GlobalAiMessage } from "../state/conversationTypes";
import { useMistyStore } from "../state/useMistyStore";
import { MessageActions, Tooltip, type MessageAction } from "@misty/ui";
import {
  Copy,
  Forward,
  PencilLine,
  RefreshCw,
  Reply,
  RotateCcw,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useSpaceWindowStore } from "@/features/app-windows";
import { spacesGateway } from "../../spaces-gateway/spacesGateway";
import { HandOffDialog } from "./HandOffDialog";
import { formatCost } from "../../context-panel/chatUsage";
import { formatTokens, tookText } from "./meta/format";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The one action bar under each message, aligned to its edge: shown only while the message is
 * hovered or holds focus. Answers share one set of actions whether they finished or failed; Try again
 * joins them only on a retryable failure.
 */
export function AgentMessageActions(props: {
  conversationId?: string;
  message: GlobalAiMessage;
  /** The message text as shown, without private context envelopes. */
  text: string;
  working: boolean;
  retryPrompt?: string;
  /** The prompt message a retry starts from. */
  retryFrom?: string;
  /** The prompt can be sent again as typed: no attachments or private context. */
  resendable?: boolean;
  onRetry: (prompt: string, fromMessageId?: string) => void;
  onEdit?: (text: string) => void;
  onReply?: (quote: string) => void;
}) {
  const { message } = props;
  const state = message.state ?? "completed";
  const user = message.role === "user";
  const [handOff, setHandOff] = useState(false);
  // Re-read when the window shows another Space.
  useSpaceWindowStore((store) => store.identity.key);
  const space = !user ? spacesGateway.maybe()?.sharedWindowSpace() : undefined;
  const speech = useReadAloud(props.text);
  if (state === "pending" || state === "streaming") return null;
  const canRetry = state === "failed" && message.retryable && props.retryPrompt;
  const actions: MessageAction[] = [];
  if (props.text)
    actions.push({
      id: "copy",
      icon: Copy,
      label: "Copy",
      onSelect: () => navigator.clipboard.writeText(props.text),
    });
  if (user && props.onEdit)
    actions.push({
      id: "edit",
      icon: PencilLine,
      label: "Edit as new message",
      onSelect: () => props.onEdit?.(props.text),
    });
  if (user && props.resendable)
    actions.push({
      id: "again",
      icon: RefreshCw,
      label: "Ask again",
      disabled: props.working,
      onSelect: () => props.onRetry(props.text, message.id),
    });
  if (!user && props.onReply && props.text)
    actions.push({
      id: "reply",
      icon: Reply,
      label: "Reply",
      onSelect: (event) => props.onReply?.(selectedText(event.currentTarget) || props.text),
    });
  if (!user && props.text && space)
    actions.push({
      id: "handoff",
      icon: Forward,
      label: "Hand off",
      onSelect: () => setHandOff(true),
    });
  if (!user && message.invocationId && props.conversationId && state === "completed") {
    const rate = (rating: "good" | "bad") =>
      rateMessage(
        props.conversationId!,
        message.id,
        message.rating === rating ? undefined : rating,
      );
    actions.push(
      {
        id: "good",
        icon: ThumbsUp,
        label: "Good response",
        pressed: message.rating === "good",
        onSelect: () => rate("good"),
      },
      {
        id: "bad",
        icon: ThumbsDown,
        label: "Bad response",
        pressed: message.rating === "bad",
        onSelect: () => rate("bad"),
      },
    );
  }
  if (!user && props.text && speech)
    actions.push({
      id: "read",
      icon: speech.speaking ? Square : Volume2,
      label: speech.speaking ? "Stop reading" : "Read aloud",
      onSelect: speech.toggle,
    });
  if (canRetry)
    actions.push({
      id: "retry",
      icon: RotateCcw,
      label: "Try again",
      disabled: props.working,
      onSelect: () => props.onRetry(props.retryPrompt!, props.retryFrom),
    });
  return (
    <>
      <MessageActions
        align={user ? "end" : "start"}
        actions={actions}
        className={user ? undefined : "mt-1"}
        trailing={user ? <MessageTime message={message} /> : undefined}
        facts={user ? undefined : <ReplyFacts message={message} />}
      />
      {handOff && space ? (
        <HandOffDialog space={space} draft={props.text} onClose={() => setHandOff(false)} />
      ) : null}
    </>
  );
}

/**
 * Keeps the person's rating with the reply, in the chat this device saves. It isn't sent
 * anywhere: runs have no server to report to.
 */
function rateMessage(conversationId: string, messageId: string, rating?: "good" | "bad") {
  useMistyStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            messages: conversation.messages.map((item) =>
              item.id === messageId ? { ...item, rating } : item,
            ),
          }
        : conversation,
    ),
  }));
}

/** Text the person highlighted inside this answer, so Reply can quote just that part. */
function selectedText(button: HTMLElement) {
  const selection = window.getSelection();
  const message = button.closest("[data-message]");
  if (!selection || selection.isCollapsed || !message) return "";
  const range = selection.getRangeAt(0);
  return message.contains(range.commonAncestorContainer) ? selection.toString().trim() : "";
}

/** Reads the reply aloud with the system's voice, and stops it. Nothing without speech. */
function useReadAloud(text: string) {
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
  return {
    speaking,
    toggle: () => {
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
    },
  };
}

/** When the message was sent; its tooltip has the full date. */
function MessageTime({ message }: { message: GlobalAiMessage }) {
  const date = new Date(message.createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <Tooltip content={fullFormat.format(date)}>
      <time dateTime={message.createdAt}>{timeFormat.format(date)}</time>
    </Tooltip>
  );
}

/**
 * A reply's facts, in view under it: how long the run took, the tokens it wrote and what it cost
 * when the engine said. The model isn't one: the chat's model is in the composer.
 * The time it was sent is the tooltip on how long it took, or stands alone when there is nothing
 * else to say.
 */
function ReplyFacts({ message }: { message: GlobalAiMessage }) {
  const date = new Date(message.createdAt);
  const sent = Number.isNaN(date.getTime()) ? "" : fullFormat.format(date);
  const facts: ReactNode[] = [];
  if (message.durationMs)
    facts.push(
      sent ? (
        <Tooltip key="took" content={sent}>
          <span>{tookText(message.durationMs)}</span>
        </Tooltip>
      ) : (
        <span key="took">{tookText(message.durationMs)}</span>
      ),
    );
  const usage = message.usage;
  if (usage?.output)
    facts.push(
      <Tooltip key="tokens" content={tokenBreakdown(usage)}>
        <span className="tabular-nums">{formatTokens(usage.output)} tokens</span>
      </Tooltip>,
    );
  const cost = usage?.costUsd;
  if (typeof cost === "number" && cost > 0) facts.push(<span key="cost">{formatCost(cost)}</span>);
  if (!message.durationMs) facts.push(<MessageTime key="time" message={message} />);
  return (
    <>
      {facts.map((fact, index) => (
        <Fragment key={index}>
          {index ? <span aria-hidden="true">·</span> : null}
          {fact}
        </Fragment>
      ))}
    </>
  );
}

/** The tokens a reply's usage report counts, for the tooltip on its total. */
function tokenBreakdown(usage: NonNullable<GlobalAiMessage["usage"]>) {
  return [
    usage.input ? `${formatTokens(usage.input)} in` : "",
    usage.output ? `${formatTokens(usage.output)} out` : "",
    usage.reasoning ? `${formatTokens(usage.reasoning)} reasoning` : "",
    usage.cacheRead ? `${formatTokens(usage.cacheRead)} cached` : "",
  ]
    .filter(Boolean)
    .join(" · ");
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
