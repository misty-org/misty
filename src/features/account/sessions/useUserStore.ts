import { create } from "zustand";
import type { AccountMeResponse } from "../api/accountTypes";

export const useUserStore = create<UserStore>((set) => ({
  me: null,
  accountId: "",
  setAccountId: (accountId) => set({ accountId }),
  loading: false,
  error: false,
  setMe: (me) => set({ me, loading: false, error: false }),
  patchMe: (patch) => set((state) => ({ me: state.me ? { ...state.me, ...patch } : state.me })),
  setLoading: (value) => set({ loading: value }),
  setError: (value) => set({ error: value }),
  clear: () => set({ me: null, loading: false, error: false }),
}));

interface UserStore {
  me: AccountMeResponse | null;
  /** The signed-in account's id, known from the saved session before `/me` answers (or while
   * offline). The account provider keeps it; clearing `me` leaves it. */
  accountId: string;
  setAccountId: (accountId: string) => void;
  loading: boolean;
  error: boolean;
  setMe: (me: AccountMeResponse) => void;
  patchMe: (patch: Partial<AccountMeResponse>) => void;
  setLoading: (value: boolean) => void;
  setError: (value: boolean) => void;
  clear: () => void;
}
