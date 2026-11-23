import { create } from "zustand";

type SetupReason = "setup" | "device" | "tabs";

type SignInReason = "account" | "sync" | "space" | "invite" | "agents" | "expired" | SetupReason;

export const setupReasonTitle: Record<SetupReason, string> = {
  setup: "Set up Misty",
  device: "Set up this computer",
  tabs: "Where do you want the sidebar?",
};

export function isSetupReason(reason: SignInReason): reason is SetupReason {
  return reason in setupReasonTitle;
}

interface SignInSheetState {
  reason: SignInReason | null;
  email: string;
  open: (reason: SignInReason, email?: string) => void;
  close: () => void;
}

export const useSignInSheetStore = create<SignInSheetState>((set) => ({
  reason: null,
  email: "",
  open: (reason, email = "") => set({ reason, email }),
  close: () => set({ reason: null, email: "" }),
}));

export function openSignInSheet(reason: SignInReason, email?: string) {
  useSignInSheetStore.getState().open(reason, email);
}
