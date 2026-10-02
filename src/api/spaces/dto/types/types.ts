import type { GlobalImageEditDefinition } from "@/api/spaces/dto/types/imageEditor";

export type SpaceRole = "owner" | "member";

export type SpaceTaskStatus = "todo" | "in_progress" | "done" | "canceled";

export type SpaceTaskPriority = "high" | "medium" | "low";

export type MessageSpan =
  | { type: "text"; text: string }
  | { type: "mention"; user_id: string; label: string }
  | { type: "mention"; agent_id: string; label: string }
  | { type: "link"; label: string; url: string };

export type BulkLibraryItemAction =
  | "favorite"
  | "unfavorite"
  | "hide"
  | "unhide"
  | "trash"
  | "restore"
  | "add_to_album"
  | "remove_from_album"
  | "add_tags"
  | "remove_tags"
  | "set_date"
  | "clear_date"
  | "set_location"
  | "clear_location";

export type LibraryEditDefinition = GlobalImageEditDefinition;
