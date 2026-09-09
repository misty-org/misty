import type {
  GlobalImageEditDefinition,
  GlobalImageMarkupElement,
} from "@/api/spaces/dto/types/imageEditor";

export type SpaceRole = "owner" | "member";

export type SpaceTaskStatus = "todo" | "in_progress" | "done" | "canceled";

export type SpaceTaskPriority = "high" | "medium" | "low";

export type MessageSpan =
  | { type: "text"; text: string }
  | { type: "mention"; user_id: string; label: string }
  | { type: "mention"; agent_id: string; label: string }
  | { type: "link"; label: string; url: string };

export type AgentMentionFailure = {
  agent_id: string;
  code:
    | "run_failed"
    | "request_canceled"
    | "hosted_ai_limit_reached"
    | "integration_required"
    | "forbidden"
    | "resource_unavailable"
    | "invalid_request"
    | string;
  message: string;
  reason?:
    | "personal_storage_limit_reached"
    | "space_storage_limit_reached"
    | "personal_ai_limit_reached"
    | "space_ai_limit_reached"
    | string;
};

export type InboxKind = "unread" | "mention" | "agent" | "approval" | "workflow";

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

export type LibraryMarkupElement = GlobalImageMarkupElement;
