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

export interface UserStore {
  me: AccountMeResponse | null;
  loading: boolean;
  error: boolean;
  setMe: (me: AccountMeResponse) => void;
  patchMe: (patch: Partial<AccountMeResponse>) => void;
  setLoading: (value: boolean) => void;
  setError: (value: boolean) => void;
  clear: () => void;
}
