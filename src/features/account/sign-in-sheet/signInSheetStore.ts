import { create } from "zustand";

/** The setup steps the sheet runs itself. */
type SetupReason = "setup" | "device" | "tabs";

/**
 * What asked for an account or for setup. Signing in again or adding an account goes to the
 * sign-in pages.
 */
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
  /** What asked, or null while nothing is asking. */
  reason: SignInReason | null;
  /** An email to start with, for signing in again. */
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

/** Asks for an account or for setup, for one of the reasons above. */
export function openSignInSheet(reason: SignInReason, email?: string) {
  useSignInSheetStore.getState().open(reason, email);
}
