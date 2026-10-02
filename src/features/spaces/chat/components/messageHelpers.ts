import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { personInitials } from "@/shared/lib/personInitials";

export { personInitials as initials };

export const quickReactionEmojis = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];

/** Managed Misty messages are stored as system events but are visibly Agent-authored. */
export function isAgentAuthoredMessage(message: SpaceMessage): boolean {
  return message.sender_kind === "agent" || message.origin?.kind === "misty_assistant";
}

/** Flattens a message to one line, rendering mentions as plain @labels. */
export function messageReplyPreviewText(message: SpaceMessage): string {
  return message.content
    .map((span) => (span.type === "text" ? span.text : `@${span.label}`))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function spansToText(content: SpaceMessage["content"]): string {
  return content.map((span) => (span.type === "text" ? span.text : `@${span.label}`)).join("");
}

export function hasAnyAttachment(message: SpaceMessage | undefined) {
  return Boolean(
    message &&
    (message.file_node_ids.length > 0 ||
      (message.library_item_ids?.length ?? 0) > 0 ||
      (message.attachments?.length ?? 0) > 0),
  );
}
