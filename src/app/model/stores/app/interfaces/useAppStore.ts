import type { AppTab } from "@/features/app-shell";
import type { AppSnapshot } from "@/services/misty/model/misty-api";

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
