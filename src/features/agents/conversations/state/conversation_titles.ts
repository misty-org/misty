import { create } from "zustand";

const waitMs = 6_000;

interface PendingTitle {
  placeholders: string[];
}

const usePendingTitles = create<Record<string, PendingTitle>>(() => ({}));

function serverPlaceholder(prompt: string) {
  const title = prompt.split(/\s+/).filter(Boolean).join(" ");
  const chars = Array.from(title);
  return chars.length > 64 ? `${chars.slice(0, 64).join("")}…` : title;
}

export function awaitConversationTitle(conversationId: string, prompt: string, localTitle: string) {
  usePendingTitles.setState({
    [conversationId]: {
      placeholders: ["", "New conversation", localTitle, serverPlaceholder(prompt)],
    },
  });
  window.setTimeout(() => {
    const { [conversationId]: _done, ...rest } = usePendingTitles.getState();
    usePendingTitles.setState(rest, true);
  }, waitMs);
}

export function useTitlePending(conversation: { id: string; title?: string } | undefined) {
  const pending = usePendingTitles((state) => (conversation ? state[conversation.id] : undefined));
  return Boolean(pending?.placeholders.includes(conversation?.title ?? ""));
}
