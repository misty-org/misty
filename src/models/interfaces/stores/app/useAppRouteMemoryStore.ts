import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AppRouteMemoryStore {
  lastAppRoute: string;
  lastSpacesRoute: string;
  rememberAppRoute: (path: string) => void;
  resetAppRoute: () => void;
}
