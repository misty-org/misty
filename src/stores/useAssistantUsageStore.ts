import { create } from "zustand";

export const assistantDailyMessageLimit = 50;
const assistantUsageStorageKey = "misty.assistant.daily-usage.v1";

interface StoredAssistantUsage {
  dateKey: string;
  messagesUsed: number;
}

interface AssistantUsageStore {
  dateKey: string;
  messagesUsedToday: number;
  syncForToday: () => void;
  consumeMessage: () => boolean;
}

const initialUsage = readStoredUsage();

export const useAssistantUsageStore = create<AssistantUsageStore>((set, get) => ({
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
    if (current >= assistantDailyMessageLimit) return false;
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

function readStoredUsage(): StoredAssistantUsage {
  const today = localDateKey();
  if (typeof window === "undefined") return { dateKey: today, messagesUsed: 0 };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(assistantUsageStorageKey) ?? "null") as Partial<StoredAssistantUsage> | null;
    if (parsed?.dateKey !== today) return { dateKey: today, messagesUsed: 0 };
    const messagesUsed = Number.isFinite(parsed.messagesUsed)
      ? Math.min(assistantDailyMessageLimit, Math.max(0, Math.floor(parsed.messagesUsed ?? 0)))
      : 0;
    return { dateKey: today, messagesUsed };
  } catch {
    return { dateKey: today, messagesUsed: 0 };
  }
}

function writeStoredUsage(usage: StoredAssistantUsage): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(assistantUsageStorageKey, JSON.stringify(usage));
  } catch {
    // Usage limits still work for this session when storage is unavailable.
  }
}
