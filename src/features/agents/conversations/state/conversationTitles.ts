import { create } from "zustand";

/** How long a new conversation's name may show as a skeleton before its opening words do. */
const waitMs = 6_000;

interface PendingTitle {
  /** Titles that only stand in for the real one. */
  placeholders: string[];
}

const usePendingTitles = create<Record<string, PendingTitle>>(() => ({}));

/** The server's stand-in title: the opening words, cut at 64 characters. */
function serverPlaceholder(prompt: string) {
  const title = prompt.split(/\s+/).filter(Boolean).join(" ");
  const chars = Array.from(title);
  return chars.length > 64 ? `${chars.slice(0, 64).join("")}…` : title;
}

/**
 * Marks a new conversation as waiting for its generated name. The server names
 * it with a separate, cheap model call; until that lands (or `waitMs` passes)
 * the sidebar and header show a skeleton instead of the opening words.
 */
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

/** Whether this conversation's name is still on its way. */
export function useTitlePending(conversation: { id: string; title?: string } | undefined) {
  const pending = usePendingTitles((state) => (conversation ? state[conversation.id] : undefined));
  return Boolean(pending?.placeholders.includes(conversation?.title ?? ""));
}
