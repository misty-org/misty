import type { SearchResult } from "@/native/ipc";

export interface ExplorerSearchNavigationTarget {
  result: SearchResult;
  path: string;
  selectEntryId: string | null;
}
