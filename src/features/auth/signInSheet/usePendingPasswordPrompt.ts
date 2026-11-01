import { useEffect } from "react";
import { useAuth } from "../authState";
import { usePasswordPending } from "../store/pendingPassword";
import { openSignInSheet, useSignInSheetStore } from "./signInSheetStore";

/** Accounts already asked for their password in this run of the app. */
const asked = new Set<string>();

/**
 * A setup-key account that has no password yet is asked for one once each time it is signed
 * in here, including when Misty starts with it. Not now leaves it for the next time.
 */
export function usePendingPasswordPrompt(): void {
  const { user } = useAuth();
  const pending = usePasswordPending(user?.id);
  const sheetOpen = useSignInSheetStore((state) => state.reason !== null);
  useEffect(() => {
    // Signing out ends the run of asking: the next sign-in asks again.
    if (!user) asked.clear();
    if (!user || !pending) return;
    // The wizard that redeemed the key shows the step itself; closing it is the answer.
    if (sheetOpen || asked.has(user.id)) {
      asked.add(user.id);
      return;
    }
    asked.add(user.id);
    openSignInSheet("password");
  }, [user, pending, sheetOpen]);
}

/** Forgets who was asked, for tests. */
export function resetPendingPasswordPromptForTests(): void {
  asked.clear();
}
