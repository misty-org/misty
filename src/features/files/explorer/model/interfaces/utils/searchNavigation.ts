import type { SearchResult } from "@/native/contracts";

export interface ExplorerSearchNavigationTarget {
  result: SearchResult;
  path: string;
  selectEntryId: string | null;
}
