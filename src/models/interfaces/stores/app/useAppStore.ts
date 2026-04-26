import { create } from "zustand";
import { appSnapshot } from "@/stores/backend";
import type { AppSnapshot } from "@/models/interfaces/services/misty-api";
import type { AppTab } from "@/models/types/routing/types";
import { errorText } from "@/lib/format";

export interface AppStore {
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
