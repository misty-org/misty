import { create } from "zustand";
import type { MeResponse } from "../pages/Dashboard/api";

interface UserStore {
  me: MeResponse | null;
  loading: boolean;
  error: boolean;
  setMe: (me: MeResponse) => void;
  patchMe: (patch: Partial<MeResponse>) => void;
  setLoading: (v: boolean) => void;
  setError: (v: boolean) => void;
  clear: () => void;
}

export const useUserStore = create<UserStore>((set) => ({
  me: null,
  loading: false,
  error: false,
  setMe:      (me)    => set({ me, loading: false, error: false }),
  patchMe:    (patch) => set((s) => ({ me: s.me ? { ...s.me, ...patch } : s.me })),
  setLoading: (v)     => set({ loading: v }),
  setError:   (v)     => set({ error: v }),
  clear:      ()      => set({ me: null, loading: false, error: false }),
}));
