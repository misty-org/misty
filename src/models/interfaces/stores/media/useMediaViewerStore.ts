import { create } from "zustand";
import type { SearchResult } from "@/models/interfaces/services/misty-api";

export interface MediaViewerState {
  result: SearchResult | null;
  open: (result: SearchResult) => void;
  close: () => void;
}
