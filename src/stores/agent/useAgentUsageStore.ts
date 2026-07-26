import type {
  StoredAgentUsage,
  AgentUsageStore,
} from "@/models/interfaces/stores/agent/useAgentUsageStore";
export type {
  StoredAgentUsage,
  AgentUsageStore,
} from "@/models/interfaces/stores/agent/useAgentUsageStore";
import { create } from "zustand";

export const agentDailyMessageLimit = 50;
// The key value is deliberately unchanged by the agent rename: it addresses
// existing localStorage entries, and renaming it would reset every user's daily
// usage counter to zero on upgrade. Only the identifier was renamed.
const agentUsageStorageKey = "misty.assistant.daily-usage.v1";

const initialUsage = readStoredUsage();

export const useAgentUsageStore = create<AgentUsageStore>((set, get) => ({
  dateKey: initialUsage.dateKey,
  messagesUsedToday: initialUsage.messagesUsed,

  syncForToday: () => {
    const today = localDateKey();
    if (get().dateKey === today) return;
    writeStoredUsage({ dateKey: today, messagesUsed: 0 });
    set({ dateKey: today, messagesUsedToday: 0 });
  },

  consumeMessage: () => {
    get().syncForToday();
    const current = get().messagesUsedToday;
    if (current >= agentDailyMessageLimit) return false;
    const next = current + 1;
    const dateKey = get().dateKey;
    writeStoredUsage({ dateKey, messagesUsed: next });
    set({ messagesUsedToday: next });
    return true;
  },
}));

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readStoredUsage(): StoredAgentUsage {
  const today = localDateKey();
  if (typeof window === "undefined") return { dateKey: today, messagesUsed: 0 };
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(agentUsageStorageKey) ?? "null",
    ) as Partial<StoredAgentUsage> | null;
    if (parsed?.dateKey !== today) return { dateKey: today, messagesUsed: 0 };
    const messagesUsed = Number.isFinite(parsed.messagesUsed)
      ? Math.min(agentDailyMessageLimit, Math.max(0, Math.floor(parsed.messagesUsed ?? 0)))
      : 0;
    return { dateKey: today, messagesUsed };
  } catch {
    return { dateKey: today, messagesUsed: 0 };
  }
}

function writeStoredUsage(usage: StoredAgentUsage): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(agentUsageStorageKey, JSON.stringify(usage));
  } catch {
    // Usage limits still work for this session when storage is unavailable.
  }
}
