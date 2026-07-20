import type { SearchResult } from "@/models/interfaces/services/misty-api";
import { useExplorerStore } from "@/stores/explorer";
import { useMediaViewerStore } from "@/stores/media/useMediaViewerStore";

export interface ExplorerSearchNavigationTarget {
  result: SearchResult;
  path: string;
  selectEntryId: string | null;
}
