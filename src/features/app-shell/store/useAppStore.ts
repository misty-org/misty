import { appSnapshot } from "@/native";
import type { AppSnapshot } from "@/native/ipc";
import { create } from "zustand";

export const useAppStore = create<AppStore>((set) => ({
  app: null,
  error: null,
  message: null,
  setError: (error) => set({ error }),
  setMessage: (message) => set({ message }),
  clearNotice: () => set({ error: null, message: null }),
  loadApp: async () => {
    try {
      set({ app: await appSnapshot(), error: null });
    } catch {
      set({ app: null });
    }
  },
}));

export interface AppStore {
  app: AppSnapshot | null;
  error: string | null;
  message: string | null;
  setError: (error: string | null) => void;
  setMessage: (message: string | null) => void;
  clearNotice: () => void;
  loadApp: () => Promise<void>;
}
