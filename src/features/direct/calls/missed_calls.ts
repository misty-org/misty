import { create } from "zustand";

export interface MissedCall {
  from: string;
  video: boolean;
  at: number;
}

export const useMissedCalls = create<{
  byDm: Record<string, MissedCall>;
  miss(dmId: string, call: MissedCall): void;
  seen(dmId: string): void;
}>((set) => ({
  byDm: {},
  miss: (dmId, call) => set((state) => ({ byDm: { ...state.byDm, [dmId]: call } })),
  seen: (dmId) =>
    set((state) => {
      if (!state.byDm[dmId]) return state;
      const next = { ...state.byDm };
      delete next[dmId];
      return { byDm: next };
    }),
}));
