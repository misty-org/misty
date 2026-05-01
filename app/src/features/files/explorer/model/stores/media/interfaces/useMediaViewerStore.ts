import type { SearchResult } from "@/native/contracts";

export interface MediaViewerState {
  result: SearchResult | null;
  open: (result: SearchResult) => void;
  close: () => void;
}
