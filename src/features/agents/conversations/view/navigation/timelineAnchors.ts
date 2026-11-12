// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { GlobalAiMessage } from "../../state/conversationTypes";
import { splitReplyQuote } from "../replyQuote";

export type MessageAnchor = {
  /** The message's id, which its element carries as `data-anchor-id`. */
  id: string;
  title: string;
  description?: string;
};

const TITLE_LIMIT = 60;
const DESCRIPTION_LIMIT = 160;

/** Whether a message is one the person typed, which is what the rail marks. */
export function isAnchorMessage(message: GlobalAiMessage): boolean {
  return message.role === "user" && !message.source && Boolean(message.content.trim());
}

function preview(message: GlobalAiMessage): MessageAnchor {
  const lines = splitReplyQuote(message.content)
    .body.split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const first = lines[0] ?? "";
  const description = lines.length > 1 ? lines.slice(1).join(" ") : first.slice(TITLE_LIMIT).trim();
  return {
    id: message.id,
    title: first.length > TITLE_LIMIT ? `${first.slice(0, TITLE_LIMIT)}…` : first,
    ...(description
      ? {
          description:
            description.length > DESCRIPTION_LIMIT
              ? `${description.slice(0, DESCRIPTION_LIMIT)}…`
              : description,
        }
      : {}),
  };
}

/**
 * One cache per chat: a typed message never changes while an answer streams, so each is
 * previewed once. Weak keys keep nothing unloaded alive; only the current list survives, and it
 * keeps its identity while nothing in it changed.
 */
export function createAnchorsBuilder() {
  const previews = new WeakMap<GlobalAiMessage, MessageAnchor>();
  let previous: MessageAnchor[] = [];
  return (messages: GlobalAiMessage[]): MessageAnchor[] => {
    const next: MessageAnchor[] = [];
    for (const message of messages) {
      if (!isAnchorMessage(message)) continue;
      let copy = previews.get(message);
      if (!copy) {
        copy = preview(message);
        previews.set(message, copy);
      }
      next.push(copy);
    }
    if (
      next.length === previous.length &&
      next.every((anchor, index) => anchor === previous[index])
    )
      return previous;
    previous = next;
    return next;
  };
}
