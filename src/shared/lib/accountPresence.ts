import { create } from "zustand";

/** How someone shows to others: their account's status, across every Space. */
export type AccountPresence = "online" | "idle" | "dnd" | "offline";

/**
 * Each person's account status, by user id, for features that can't import the status code (a Space's
 * member list). The status store (`features/direct`) fills it as statuses arrive; it keeps nothing of its
 * own and starts empty, where a feature falls back to what it knew before.
 */
export const useAccountPresence = create<{ byUser: Record<string, AccountPresence> }>(() => ({
  byUser: {},
}));
