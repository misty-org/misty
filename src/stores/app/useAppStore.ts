import type { AppStore } from "@/models/interfaces/stores/app/useAppStore";
export type { AppStore } from "@/models/interfaces/stores/app/useAppStore";
import { create } from "zustand";
import { appSnapshot } from "@/stores/backend";
import type { AppSnapshot } from "@/models/interfaces/services/misty-api";
import type { AppTab } from "@/models/types/routing/types";
import { errorText } from "@/lib/format";

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
