import type { SpaceMessage } from "../../api/dto/entities";
import { personInitials } from "@/shared/lib/person_initials";

export { personInitials as initials };

export const quickReactionEmojis = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];

export function isAgentAuthoredMessage(message: SpaceMessage): boolean {
  return message.sender_kind === "agent" || message.origin?.kind === "misty_assistant";
}

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
    message && (message.file_node_ids.length > 0 || (message.attachments?.length ?? 0) > 0),
  );
}

export function threadRootOf(
  message: { id: string; reply_to_message_id?: string },
  byId: Map<string, { id: string; reply_to_message_id?: string }>,
): string {
  let current = message;
  for (let hops = 0; hops < 100; hops++) {
    const parent = current.reply_to_message_id ? byId.get(current.reply_to_message_id) : undefined;
    if (!parent) return current.id;
    current = parent;
  }
  return current.id;
}
