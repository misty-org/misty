import { create } from "zustand";

export type AccountPresence = "online" | "idle" | "dnd" | "offline";

export const useAccountPresence = create<{ byUser: Record<string, AccountPresence> }>(() => ({
  byUser: {},
}));
