import type { GlobalAiMessage } from "../state/conversationTypes";
import { useMistyStore } from "../state/useMistyStore";
import { MessageActions, Tooltip, type MessageAction } from "@/shared/ui";
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
import { useEffect, useRef, useState } from "react";
import { useSpaceWindowStore } from "@/features/app-windows";
import { spacesGateway } from "../../spaces-gateway/spacesGateway";
import { HandOffDialog } from "./HandOffDialog";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The one action bar under each message, aligned to its edge: shown on hover and always on the
 * latest message. Answers share one set of actions whether they finished or failed; Try again
 * joins them only on a retryable failure.
 */
export function AgentMessageActions(props: {
  conversationId?: string;
  message: GlobalAiMessage;
  /** The message text as shown, without private context envelopes. */
  text: string;
  working: boolean;
  /** The last message in the chat: its bar stays shown. */
  latest?: boolean;
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
        alwaysVisible={props.latest}
        actions={actions}
        className={user ? undefined : "mt-1"}
        trailing={<MessageTime message={message} />}
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

/** Speech reads prose, not Markdown punctuation. */
function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1");
}
