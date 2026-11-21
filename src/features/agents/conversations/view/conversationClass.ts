/**
 * The conversation's column, and the rhythm of the Markdown replies in it: only the person's
 * messages are bubbles, so replies sit on the canvas as plain text at the control size. The
 * paragraph margins win over the Markdown stylesheet's own, except a callout's title.
 */
export const conversationClass = [
  "agent-conversation relative flex min-h-0 min-w-0 flex-1 flex-col",
  "[&_.misty-markdown-message]:pt-1 [&_.misty-markdown-message]:text-control",
  "[&_.misty-markdown-message]:leading-[1.6]",
  "[&_.misty-markdown-message_p:not(.misty-markdown-callout-title)]:mt-0!",
  "[&_.misty-markdown-message_p:not(.misty-markdown-callout-title)]:mb-2.5!",
  "[&_.misty-markdown-message_p:not(.misty-markdown-callout-title):last-child]:mb-0!",
].join(" ");
