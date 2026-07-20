import {
  mediaSearchResolveAssets,
  mediaSearchSnapshot,
  searchQuery,
  smartLibraryResolveAssets,
  smartLibrarySnapshot,
} from "@/stores/backend";
import type { SearchQueryScope, SearchSourceKind } from "@/models/types/services/misty-api";
import type {
  ExplorerLibrarySnapshot,
  ExplorerLocation,
  FileEntry,
  ResolvedSmartLibraryAsset,
  ResolvedMediaAsset,
  SearchQueryRequest,
  SearchResult,
  SearchResultMatch,
  SmartLibraryAsset,
  SavedSearchRule,
} from "@/models/interfaces/services/misty-api";
import { searchSemanticAssets } from "@/stores/media/useSmartLibraryServerStore";
import type { SemanticSearchHit } from "@/models/interfaces/stores/media/useSmartLibraryServerStore";
import { searchMedia } from "@/stores/media/useMediaSearchServerStore";
import type { MediaSearchHit } from "@/models/interfaces/stores/media/useMediaSearchServerStore";
import { ensureMediaSearchDeviceReady } from "@/stores/media/useMediaSearchMigrationStore";
import { mergeLibrarySearchResults } from "@/features/explorer/utils/librarySearch";

export interface ExplorerSearchOptions {
  currentPath?: string | null;
  scope?: SearchQueryScope;
  includeFiles?: boolean;
  includeDirectories?: boolean;
  includeHidden?: boolean;
  limit?: number | null;
  rules?: SavedSearchRule[];
  matchMode?: "all" | "any";
}
