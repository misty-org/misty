import type { GlobalAiMessage } from "../state/conversation_types";
import { useMistyStore } from "../state/use_misty_store";
import { MessageActions, notify, type MessageAction } from "@misty/ui";
import { say, stopSaying, useSpeechSupport } from "@/features/voice";
import { usePersonalAgentsStore } from "../../personal/personal_agents_store";
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

export function AgentMessageActions(props: {
  conversationId?: string;
  message: GlobalAiMessage;
  text: string;
  working: boolean;
  retryPrompt?: string;
  resendable?: boolean;
  onRetry: (prompt: string) => void;
  onEdit?: (text: string) => void;
  onReply?: (quote: string) => void;
}) {
  const { message } = props;
  const state = message.state ?? "completed";
  const user = message.role === "user";
  const [handOff, setHandOff] = useState(false);
  useSpaceWindowStore((store) => store.identity.key);
  const space = !user ? spacesGateway.maybe()?.sharedWindowSpace() : undefined;
  const speech = useReadAloud(props.text, props.conversationId);
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
      onSelect: () => props.onRetry(props.text),
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
      onSelect: () => props.onRetry(props.retryPrompt!),
    });
  return (
    <>
      <MessageActions align="start" alwaysVisible actions={actions} />
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

function useReadAloud(text: string, conversationId?: string) {
  const support = useSpeechSupport();
  const voice = useMistyStore((state) => {
    const agentId = state.conversations.find((chat) => chat.id === conversationId)?.agentId;
    return usePersonalAgentsStore.getState().agents.find((agent) => agent.id === agentId)?.voice;
  });
  const [speaking, setSpeaking] = useState(false);
  const reading = useRef(false);
  useEffect(
    () => () => {
      if (reading.current) void stopSaying();
    },
    [],
  );
  if (!support?.speaking) return null;
  return {
    speaking,
    toggle: () => {
      if (speaking) {
        void stopSaying();
        return;
      }
      reading.current = true;
      setSpeaking(true);
      void say(plainText(text), voice || undefined)
        .catch((reason: unknown) => notify({ message: String(reason), tone: "error" }))
        .finally(() => {
          reading.current = false;
          setSpeaking(false);
        });
    },
  };
}

export function replyDetails(message: GlobalAiMessage, when: string) {
  const usage = message.usage;
  const cost = usage?.costUsd;
  return [
    when,
    message.durationMs ? `worked for ${tookText(message.durationMs)}` : "",
    usage?.output ? tokenBreakdown(usage) : "",
    typeof cost === "number" && cost > 0 ? formatCost(cost) : "",
  ]
    .filter(Boolean)
    .join(", ");
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
