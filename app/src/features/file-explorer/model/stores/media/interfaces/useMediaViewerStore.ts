import type { SearchResult } from "@/services/misty/model/misty-api";

export interface MediaViewerState {
  result: SearchResult | null;
  open: (result: SearchResult) => void;
  close: () => void;
}
