import { readAccountAuthToken } from "@/stores/account/useAuthTokenStore";
import { appSnapshot } from "@/stores/backend";
import { safeTauriAssetUrl } from "@/platform/tauri";
import type { SpaceConversation, SpaceRun } from "@/models/interfaces/features/spaces/types";
import type {
  AgentMentionFailure,
  MessageSpan,
  BulkLibraryItemAction,
  LibraryEditDefinition,
  SpaceTaskPriority,
  SpaceTaskStatus,
} from "@/models/types/features/spaces/types";
import type {
  BulkLibraryItemOptions,
  LibraryUploadResult,
  LibraryAlbum,
  LibraryAlbumFolder,
  LibraryGroup,
  LibraryGroupRule,
  LibraryItemQuery,
  LibraryItemsResult,
  LibrarySearchFacets,
  LibraryDiscovery,
  LibrarySharedReference,
  LibraryIntelligencePolicy,
  LibraryPerson,
  LibraryEditResult,
  LibraryEditVersion,
  LibraryRenditionRequest,
  LibraryPinnedCollection,
  LibraryImportHistoryItem,
  LibraryAssetStack,
  Space,
  SpaceEvent,
  SpaceInboxItem,
  SpaceMember,
  SpaceMessage,
  SpaceLibraryItem,
  SpaceStorageUsage,
  SpaceNode,
  SpacesSnapshot,
  SpaceStudioResource,
  SpaceTask,
  SpaceTaskPage,
  SpaceTaskMoveResult,
  SpaceCalendarEvent,
  SpaceCalendarSource,
  GoogleCalendarChoice,
} from "@/models/interfaces/features/spaces/types";
import { normalizeApiBaseUrl, withDefaultApiPath } from "@/stores/backend";

import type { RealtimeEnvelope } from "@/models/types/stores/spaces/useSpacesBackendStore";

export interface LibraryUploadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  onStage?: (stage: "reading" | "hashing" | "uploading" | "finalizing") => void;
}
