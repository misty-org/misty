import type { SpaceMessage } from "@/models/interfaces/features/spaces/types";
import { personInitials } from "../personInitials";

export { personInitials as initials };

export const quickReactionEmojis = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];

/** Flattens a message to one line, rendering mentions as plain @labels. */
export function messageReplyPreviewText(message: SpaceMessage): string {
  return message.content
    .map((span) => (span.type === "text" ? span.text : `@${span.label}`))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Only a person's own Misty message may be mirrored outward. Agent output,
 * system notices, and messages that arrived *from* Discord are never republished
 * — that is what keeps the mirror from looping.
 */
export function canPublish(message: SpaceMessage, currentUserId?: string) {
  return (
    message.sender_kind === "person" &&
    message.sender_user_id === currentUserId &&
    (message.origin?.system ?? "misty") === "misty"
  );
}

export function hasAnyAttachment(message: SpaceMessage | undefined) {
  return Boolean(
    message &&
    (message.file_node_ids.length > 0 ||
      (message.library_item_ids?.length ?? 0) > 0 ||
      (message.attachments?.length ?? 0) > 0),
  );
}
