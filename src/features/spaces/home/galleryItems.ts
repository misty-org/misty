import type { SpaceDrawing } from "@/api/drawings/types";
import type { ServerSpaceNote } from "@/api/notes/api";
import type { SpaceCodeProject } from "@/api/spaces/code-projects";
import type { SpaceConversation } from "@/api/spaces/dto/conversationTypes";
import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";
import type { ItemVisibility, VisibilityItemKind } from "@/api/spaces/visibility";
import { libraryItemMIME } from "@/features/library";
import { conversationPath } from "../chat/chatRoute";

/** One thing made in a Space, as the Space home shows it. */
export type GalleryKind = "chat" | "note" | "drawing" | "image" | "file" | "code";

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
  repo?: string;
  /** Who a chat is with. */
  people?: string[];
  /** The item's layer; a private item shows a lock and the word "Private". */
  visibility?: ItemVisibility;
  /** What its owner flips from the item's menu. Chats have no toggle. */
  toggle?: { kind: VisibilityItemKind; id: string };
}

export type GalleryFilter = "all" | "chats" | "notes" | "drawings" | "images" | "files" | "code";
export type GalleryMadeBy = "anyone" | "me" | "others";
export type GallerySort = "edited" | "name";

/** The Space home's tabs, in order. */
export const galleryFilters: ReadonlyArray<{
  id: GalleryFilter;
  label: string;
  kind?: GalleryKind;
}> = [
  { id: "all", label: "All" },
  { id: "chats", label: "Chats", kind: "chat" },
  { id: "notes", label: "Notes", kind: "note" },
  { id: "drawings", label: "Drawings", kind: "drawing" },
  { id: "images", label: "Images", kind: "image" },
  { id: "files", label: "Files", kind: "file" },
  { id: "code", label: "Code", kind: "code" },
];

export function isGalleryFilter(value: string | null): value is GalleryFilter {
  return galleryFilters.some((filter) => filter.id === value);
}

const base = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}`;

/** A chat with people or an agent; it is one more thing in the Space, like a note. */
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

/** A chat with one of your agents. Until agent chats move into Spaces, they show in your own Space. */
export function agentChatItem(
  conversation: { id: string; title?: string; agentId?: string; updatedAt: string },
  agent: { id: string; name: string } | undefined,
  me: string,
): GalleryItem {
  const params = new URLSearchParams({ conversation: conversation.id });
  if (agent) params.set("agent", agent.id);
  return {
    key: `agent-chat:${conversation.id}`,
    kind: "chat",
    title: conversation.title?.trim() || "Untitled chat",
    updatedAt: conversation.updatedAt,
    creatorId: me,
    href: `/agents?${params}`,
    people: agent ? [agent.name] : [],
  };
}

export function noteItem(spaceId: string, note: ServerSpaceNote): GalleryItem {
  const text = (note.plain_text ?? note.markdown ?? "").replace(/\s+/g, " ").trim();
  return {
    key: `note:${note.id}`,
    kind: "note",
    title: note.title.trim() || "Untitled note",
    updatedAt: note.updated_at ?? note.created_at ?? "",
    creatorId: note.creator_user_id,
    href: `${base(spaceId)}/notes?note=${encodeURIComponent(note.id)}`,
    excerpt: text.slice(0, 220),
    visibility: note.visibility,
    toggle: { kind: "note", id: note.id },
  };
}

export function drawingItem(spaceId: string, drawing: SpaceDrawing): GalleryItem {
  return {
    key: `drawing:${drawing.id}`,
    kind: "drawing",
    title: drawing.title.trim() || "Untitled drawing",
    updatedAt: drawing.updated_at,
    creatorId: drawing.creator_user_id,
    href: `${base(spaceId)}/drawings/${encodeURIComponent(drawing.id)}`,
    visibility: drawing.visibility,
    toggle: { kind: "drawing", id: drawing.id },
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
    href: `${base(spaceId)}/library?item=${encodeURIComponent(item.id)}`,
    libraryItem: item,
    visibility: item.visibility,
    toggle: { kind: "library_item", id: item.id },
  };
}

export function codeItem(spaceId: string, project: SpaceCodeProject): GalleryItem {
  return {
    key: `code:${project.id}`,
    kind: "code",
    title: project.name || project.github_repo || "Code project",
    updatedAt: project.updated_at || project.linked_at,
    creatorId: project.owner_user_id,
    href: `${base(spaceId)}/code`,
    repo: project.github_repo,
    visibility: project.visibility,
    toggle: { kind: "code_project", id: project.id },
  };
}

/** What the current tab, maker and sort leave, newest first unless sorted by name. */
export function visibleGallery(
  items: GalleryItem[],
  options: {
    filter: GalleryFilter;
    madeBy: GalleryMadeBy;
    sort: GallerySort;
    me: string;
    query: string;
  },
): GalleryItem[] {
  const kind = galleryFilters.find((filter) => filter.id === options.filter)?.kind;
  const query = options.query.trim().toLowerCase();
  const kept = items.filter(
    (item) =>
      (!kind || item.kind === kind) &&
      (options.madeBy === "anyone" ||
        (options.madeBy === "me"
          ? item.creatorId === options.me
          : item.creatorId !== options.me)) &&
      (!query ||
        item.title.toLowerCase().includes(query) ||
        item.excerpt?.toLowerCase().includes(query)),
  );
  return kept.sort((a, b) =>
    options.sort === "name"
      ? a.title.localeCompare(b.title)
      : Date.parse(b.updatedAt || "0") - Date.parse(a.updatedAt || "0"),
  );
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
export function editedLabel(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.round((at - now) / 1000);
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
