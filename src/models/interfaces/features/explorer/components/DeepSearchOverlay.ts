import { Input } from "@/ui";
import { Button } from "@/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui";
import { CornerDownLeft, ListFilter, Loader2, Search } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { SearchQueryScope } from "@/models/types/services/misty-api";
import type { SearchResult } from "@/models/interfaces/services/misty-api";
import { formatBytes, formatDate } from "@/features/explorer/utils/fileFormat";
import { useSearchStore } from "@/stores/explorer";
import {
  revealSearchResultInPane,
  searchResultNavigationTarget,
} from "@/features/explorer/utils/searchNavigation";
import {
  searchResultContext,
  searchResultSummary,
} from "@/features/explorer/components/ExplorerToolbarSupport";
import { SearchResultThumbnail } from "@/features/explorer/components/SearchResultThumbnail";
import { useExplorerStore } from "@/stores/explorer";
import {
  compileEntryFilterMatcher,
  entryMatchesQuery,
} from "@/features/explorer/components/FileBrowserFilters";

export interface DeepSearchOverlayProps {
  activePaneId: string;
  currentPath: string;
}
