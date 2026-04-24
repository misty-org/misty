import type { WorkflowVersion } from "@/models/interfaces/features/spaces/agentArchitectureTypes";
import type {
  GlobalImageEditDefinition,
  GlobalImageMarkupElement,
} from "@/models/interfaces/features/editor/imageEditor";

import type {
  Space,
  SpaceInvitation,
  SpaceMember,
  SpaceTask,
  SpaceTaskPage,
  SpaceTaskMoveResult,
  SpaceCalendarSource,
  SpaceCalendarEvent,
  GoogleCalendarChoice,
  SpaceMessage,
  SpaceNode,
  SpaceInboxItem,
  SpaceEvent,
  SpaceStudioResource,
  SpacesSnapshot,
  LibraryFile,
  SpaceLibraryItem,
  LibraryAssetStackMember,
  LibraryAssetStack,
  LibraryItemQuery,
  LibraryItemsResult,
  BulkLibraryItemOptions,
  LibrarySearchFacet,
  LibrarySearchFacets,
  LibraryDiscoveryGroup,
  LibraryDiscovery,
  LibraryPinnedCollection,
  LibraryImportHistoryItem,
  LibrarySharedReference,
  SpaceStorageUsage,
  MessageAttachment,
  LibraryUploadResult,
  LibraryAlbum,
  LibraryAlbumFolder,
  LibraryGroupRule,
  LibraryGroup,
  LibraryIntelligencePolicy,
  LibraryPerson,
  LibraryEditVersion,
  LibraryRenditionRequest,
  LibraryEditResult,
} from "@/models/interfaces/features/spaces/types";

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
