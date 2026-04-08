import type { UserStore } from "@/models/interfaces/stores/account/useUserStore";
export type { UserStore } from "@/models/interfaces/stores/account/useUserStore";
import { create } from "zustand";
import type { AccountMeResponse } from "@/models/interfaces/stores/account/useAccountStore";

export const useUserStore = create<UserStore>((set) => ({
  me: null,
  loading: false,
  error: false,
  setMe: (me) => set({ me, loading: false, error: false }),
  patchMe: (patch) => set((state) => ({ me: state.me ? { ...state.me, ...patch } : state.me })),
  setLoading: (value) => set({ loading: value }),
  setError: (value) => set({ error: value }),
  clear: () => set({ me: null, loading: false, error: false }),
}));
