import type { SpaceConversation } from "../api/dto/conversation_types";
import type { ItemVisibility, VisibilityItemKind } from "../api/visibility";
import { conversationPath } from "../chat/chat_route";

export type GalleryKind = "chat";

export interface GalleryItem {
  key: string;
  kind: GalleryKind;
  title: string;
  updatedAt: string;
  creatorId: string;
  href: string;
  excerpt?: string;
  people?: string[];
  visibility?: ItemVisibility;
  toggle?: { kind: VisibilityItemKind; id: string };
  private?: boolean;
  remove?: () => Promise<unknown>;
  removeLabel?: string;
}

export function chatItem(
  spaceId: string,
  conversation: SpaceConversation,
  me: string,
): GalleryItem {
  const people = conversation.participants
    .filter((person) => person.agent_id || person.user_id !== me)
    .map((person) => person.name)
    .filter(Boolean);
  return {
    key: `chat:${conversation.id}`,
    kind: "chat",
    title: conversation.title.trim() || people.join(", ") || "Untitled chat",
    updatedAt: conversation.updated_at || conversation.created_at,
    creatorId: conversation.created_by_user_id,
    href: conversationPath(spaceId, conversation),
    people,
  };
}

const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function editedLabel(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.round((at - now) / 1000);
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
