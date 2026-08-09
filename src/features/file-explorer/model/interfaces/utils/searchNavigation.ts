import type { SearchResult } from "@/services/misty/model/misty-api";

export interface ExplorerSearchNavigationTarget {
  result: SearchResult;
  path: string;
  selectEntryId: string | null;
}
