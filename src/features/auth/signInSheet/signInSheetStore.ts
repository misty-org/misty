import { create } from "zustand";

/**
 * What asked for an account. Misty works as a full browser without one; the sign-in sheet
 * opens only for these, and its title says which (docs/browser/no-account.md).
 */
export type SignInReason =
  "account" | "sync" | "space" | "invite" | "agents" | "expired" | "setup" | "password";

export const signInReasonCopy: Record<SignInReason, { title: string; description: string }> = {
  account: {
    title: "Sign in to Misty",
    description:
      "An account syncs your browsing, lets you share Spaces and runs agents. Browsing works without one.",
  },
  sync: {
    title: "Sign in to turn on sync",
    description:
      "Your tabs, bookmarks, passwords and history sync end-to-end encrypted between your devices.",
  },
  space: {
    title: "Sign in to create a Space",
    description:
      "A Space keeps one part of your life apart, with its own tabs, sign-ins, memory and agents, and you can share it with people.",
  },
  invite: {
    title: "Sign in to join a Space",
    description: "You were invited to a Space. Sign in or create an account to join it.",
  },
  agents: {
    title: "Sign in to use agents",
    description:
      "Agents run on this computer, and their chats and tools need a Misty account. Browsing works without one.",
  },
  setup: {
    title: "Set up Misty",
    description:
      "Misty works as a browser on its own. A Misty server adds sync, Spaces and agents.",
  },
  password: {
    title: "Choose a password",
    description: "You'll use it to sign in on your other computers. Sync starts once it's set.",
  },
  expired: {
    title: "Sign in again",
    description:
      "Your session ended. Sign in again to reconnect sync and agents; browsing carries on meanwhile.",
  },
};

interface SignInSheetState {
  /** Why the sheet is open, or null while it is closed. */
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

/** Opens the sign-in sheet over the window for one of the reasons above. */
export function openSignInSheet(reason: SignInReason, email?: string) {
  useSignInSheetStore.getState().open(reason, email);
}
