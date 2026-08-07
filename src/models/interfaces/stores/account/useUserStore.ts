import { create } from "zustand";
import type { AccountMeResponse } from "@/models/interfaces/stores/account/useAccountStore";

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
