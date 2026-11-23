import { create } from "zustand";

export const useDirectAccount = create<{ userId: string | undefined }>(() => ({
  userId: undefined,
}));

export const useDirectUserId = () => useDirectAccount((state) => state.userId);
