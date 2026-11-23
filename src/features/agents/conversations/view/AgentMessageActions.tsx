import type { GlobalAiMessage } from "../state/conversation_types";
import { useMistyStore } from "../state/use_misty_store";
import { MessageActions, Tooltip, useNow, type MessageAction } from "@misty/ui";
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
import { spacesGateway } from "../../spaces-gateway/spaces_gateway";
import { HandOffDialog } from "./HandOffDialog";
import { formatCost } from "../../context-panel/chat_usage";
import { formatTokens, tookText } from "./meta/format";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function AgentMessageActions(props: {
  conversationId?: string;
  message: GlobalAiMessage;
  text: string;
  working: boolean;
  retryPrompt?: string;
  retryFrom?: string;
  resendable?: boolean;
  onRetry: (prompt: string, fromMessageId?: string) => void;
  onEdit?: (text: string) => void;
  onReply?: (quote: string) => void;
}) {
  const { message } = props;
  const state = message.state ?? "completed";
  const user = message.role === "user";
  const [handOff, setHandOff] = useState(false);
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
        trailing={user ? <MessageTime message={message} /> : <ReplyTime message={message} />}
      />
      {handOff && space ? (
        <HandOffDialog space={space} draft={props.text} onClose={() => setHandOff(false)} />
      ) : null}
    </>
  );
}

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

function selectedText(button: HTMLElement) {
  const selection = window.getSelection();
  const message = button.closest("[data-message]");
  if (!selection || selection.isCollapsed || !message) return "";
  const range = selection.getRangeAt(0);
  return message.contains(range.commonAncestorContainer) ? selection.toString().trim() : "";
}

function useReadAloud(text: string) {
  const [speaking, setSpeaking] = useState(false);
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

function MessageTime({ message }: { message: GlobalAiMessage }) {
  const date = new Date(message.createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <Tooltip content={fullFormat.format(date)}>
      <time dateTime={message.createdAt}>{timeFormat.format(date)}</time>
    </Tooltip>
  );
}

function ReplyTime({ message }: { message: GlobalAiMessage }) {
  const now = useNow();
  const date = new Date(message.createdAt);
  if (Number.isNaN(date.getTime())) return null;
  const usage = message.usage;
  const cost = usage?.costUsd;
  const details = [
    fullFormat.format(date),
    message.durationMs ? `worked for ${tookText(message.durationMs)}` : "",
    usage?.output ? tokenBreakdown(usage) : "",
    typeof cost === "number" && cost > 0 ? formatCost(cost) : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Tooltip content={details}>
      <time dateTime={message.createdAt}>{agoText(date.getTime(), now)}</time>
    </Tooltip>
  );
}

function agoText(time: number, now: number) {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return timeFormat.format(time);
}

function tokenBreakdown(usage: NonNullable<GlobalAiMessage["usage"]>) {
  return [
    usage.input ? `${formatTokens(usage.input)} in` : "",
    usage.output ? `${formatTokens(usage.output)} out` : "",
    usage.reasoning ? `${formatTokens(usage.reasoning)} reasoning` : "",
    usage.cacheRead ? `${formatTokens(usage.cacheRead)} cached` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1");
}
