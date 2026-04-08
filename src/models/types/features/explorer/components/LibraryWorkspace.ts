import { Input } from "@/ui";
import { Button } from "@/ui";
import { Badge } from "@/ui";
import { Dialog, DialogContent, DialogTitle } from "@/ui";
import { Progress } from "@/ui";
import {
  File,
  Film,
  FolderSearch,
  Images,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { savedSearchesDelete, savedSearchesSave, savedSearchesSnapshot } from "@/stores/backend";
import type {
  SavedSearch,
  SavedSearchRule,
  SearchResult,
  SmartLibraryAsset,
} from "@/models/interfaces/services/misty-api";
import { safeTauriAssetUrl } from "@/platform/tauri";
import { useSmartLibraryStore } from "@/stores/media/useSmartLibraryStore";
import { useMediaSearchStore } from "@/stores/media/useMediaSearchStore";
import { revealSearchResultInPane } from "@/features/explorer/utils/searchNavigation";
import {
  mergeHybridSearchResults,
  queryIndexedExplorerSearch,
  querySemanticExplorerSearch,
} from "@/features/explorer/utils/globalSearch";
import { searchResultNavigationTarget } from "@/features/explorer/utils/searchNavigation";
import {
  createSmartFolderDialogState,
  smartFolderId,
  smartFolderMatchMode,
  smartFolderQueryFromRules,
  smartFolderRulesWithMode,
  sortSavedSearches,
} from "@/features/explorer/components/ExplorerSidebarSupport";
import type { SmartFolderDialogState } from "@/models/types/features/explorer/components/ExplorerSidebarSupport";
import type { SmartFolderDraft } from "@/models/interfaces/features/explorer/components/ExplorerSidebarSupport";
import { SmartFolderDialog } from "@/features/explorer/components/ExplorerSidebarDialogs";
import { SearchResultThumbnail } from "@/features/explorer/components/SearchResultThumbnail";
import {
  searchResultContext,
  searchResultSummary,
} from "@/features/explorer/components/ExplorerToolbarSupport";
import { searchSemanticAssets } from "@/stores/media/useSmartLibraryServerStore";
import { formatBytes, formatDate } from "@/features/explorer/utils/fileFormat";
import {
  aggregateLibraryTags,
  DEFAULT_ASSET_TAG_LIMIT,
  DEFAULT_LIBRARY_TAG_LIMIT,
  tagsWithout,
  visibleAssetTags,
  visibleLibraryTags,
} from "@/features/explorer/utils/libraryTags";
import { GlobalPreviewDialog } from "@/features/explorer/components/GlobalPreview";
import { LibraryDropReviewDialog } from "@/features/explorer/components/LibraryDropReviewDialog";
import {
  MediaIndexApprovalDialog,
  MediaIndexRemovalDialog,
} from "@/features/explorer/components/MediaIndexDialogs";

export type LibraryTab = "library" | "collections" | "tags" | "media";
