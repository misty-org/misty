import { create } from "zustand";
import { appSnapshot } from "../api/misty";
import type { AppSnapshot } from "../api/types";
import type { AppTab } from "../routing/types";
import { errorText } from "@/shared/format";

interface AppStore {
  app: AppSnapshot | null;
  activeTab: AppTab;
  error: string | null;
  message: string | null;
  setActiveTab: (tab: AppTab) => void;
  setError: (error: string | null) => void;
  setMessage: (message: string | null) => void;
  clearNotice: () => void;
  loadApp: () => Promise<void>;
}

export const useAppStore = create<AppStore>((set) => ({
  app: null,
  activeTab: "providers",
  error: null,
  message: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setError: (error) => set({ error }),
  setMessage: (message) => set({ message }),
  clearNotice: () => set({ error: null, message: null }),
  loadApp: async () => {
    try {
      set({ app: await appSnapshot(), error: null });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },
}));
