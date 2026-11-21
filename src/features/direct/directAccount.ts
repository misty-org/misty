import { create } from "zustand";

/**
 * The signed-in account, as DirectRoot was given it. The DMs feature reads it from here instead
 * of the account feature, which itself shows DM settings (so neither imports the other).
 */
export const useDirectAccount = create<{ userId: string | undefined }>(() => ({ userId: undefined }));

export const useDirectUserId = () => useDirectAccount((state) => state.userId);
