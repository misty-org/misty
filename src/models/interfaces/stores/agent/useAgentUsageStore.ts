import { create } from "zustand";

export interface StoredAgentUsage {
  dateKey: string;
  messagesUsed: number;
}

export interface AgentUsageStore {
  dateKey: string;
  messagesUsedToday: number;
  syncForToday: () => void;
  consumeMessage: () => boolean;
}
