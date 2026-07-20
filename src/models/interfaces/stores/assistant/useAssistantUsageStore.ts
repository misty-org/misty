import { create } from "zustand";

export interface StoredAssistantUsage {
  dateKey: string;
  messagesUsed: number;
}

export interface AssistantUsageStore {
  dateKey: string;
  messagesUsedToday: number;
  syncForToday: () => void;
  consumeMessage: () => boolean;
}
