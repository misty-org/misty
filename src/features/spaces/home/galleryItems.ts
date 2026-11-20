import type { SpaceConversation } from "../api/dto/conversation-types";
import type { SpaceLibraryItem } from "../api/dto/entities";
import type { ItemVisibility, VisibilityItemKind } from "../api/visibility";
import { libraryItemMIME } from "../library";
import { conversationPath } from "../chat/chatRoute";

/** One thing in a Space, as search finds it: a chat or one of its files. */
export type GalleryKind = "chat" | "image" | "file";

export interface GalleryItem {
  /** Unique across kinds, for React keys. */
  key: string;
  kind: GalleryKind;
  title: string;
  updatedAt: string;
  /** Who made it; empty when the source doesn't say. */
  creatorId: string;
  /** Where opening it goes. */
  href: string;
  excerpt?: string;
  libraryItem?: SpaceLibraryItem;
  /** Who a chat is with. */
  people?: string[];
  /** The item's layer; a private item shows a lock and the word "Private". */
  visibility?: ItemVisibility;
  /** What its owner flips from the item's menu. Chats have no toggle. */
  toggle?: { kind: VisibilityItemKind; id: string };
  /** Only the people in it can see it (a direct chat), whatever the Space's size. */
  private?: boolean;
  /** Removal operation when the current person is allowed to remove this item. */
  remove?: () => Promise<unknown>;
  removeLabel?: string;
}

const base = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}`;

/** A chat with people or an agent; it is one more thing in the Space, like a file. */
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

/** Pictures and videos are Images; everything else uploaded or made is a File. */
export function libraryKind(item: SpaceLibraryItem): "image" | "file" {
  const mime = libraryItemMIME(item);
  return mime.startsWith("image/") || mime.startsWith("video/") ? "image" : "file";
}

export function libraryGalleryItem(spaceId: string, item: SpaceLibraryItem): GalleryItem {
  return {
    key: `file:${item.id}`,
    kind: libraryKind(item),
    title: item.display_name || item.file.original_filename || "Untitled file",
    updatedAt: item.updated_at || item.added_at,
    creatorId: item.added_by_user_id || item.contributing_user_id,
    href: `${base(spaceId)}/files?item=${encodeURIComponent(item.id)}`,
    libraryItem: item,
    visibility: item.visibility,
    toggle: { kind: "library_item", id: item.id },
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

/** "2 hours ago", "yesterday", "just now". */
export function editedLabel(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.round((at - now) / 1000);
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
