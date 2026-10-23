import { flushWorkspaceRecovery } from "@/features/browser-sync/recovery";
import { useNativeSessionStore } from "@/features/native-session";
import { removeAccountWorkspace, saveAccountWorkspace } from "@/features/workspace";
import { reportSystemError } from "@/features/support/systemErrors";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { resetAccountScopedState } from "../authSession";
import { accountLogout } from "../store/useAccountStore";
import {
  deactivateActiveAccount,
  listSavedAccountSessions,
  removeSavedAccountSession,
} from "../store/useAuthTokenStore";
import type { AccountStateSetters } from "./providerTypes";

// Signs out the active account and returns to Welcome, ahead of the chooser, without
// silently jumping to another saved account. Other saved accounts stay listed; ending the
// session (logging out) also removes the account itself.
// Saving the workspace and clearing native identity are best-effort: a failed
// cleanup step is reported, but never leaves the person signed in.
export function useDeactivateToChooser(
  activeUserId: string | undefined,
  { setUserState, setAccounts }: AccountStateSetters,
) {
  const signOut = useNativeSessionStore((state) => state.signOut);
  const navigate = useNavigate();
  return useCallback(
    async ({
      endSession = false,
    }: {
      endSession?: boolean;
    } = {}) => {
      const accountId = activeUserId ?? "";
      const failures: unknown[] = [];
      const attempt = async (step: () => unknown) => {
        try {
          await step();
        } catch (error) {
          failures.push(error);
        }
      };
      await attempt(flushWorkspaceRecovery);
      if (accountId && !endSession) await attempt(() => saveAccountWorkspace(accountId));
      // Signing out ends the server session and removes the account from this device;
      // adding it again needs its password.
      if (endSession && accountId) await attempt(() => accountLogout(accountId));
      await attempt(deactivateActiveAccount);
      if (endSession && accountId) {
        await attempt(async () => {
          if (!(await removeSavedAccountSession(accountId)))
            throw new Error("Could not remove the saved account.");
          await removeAccountWorkspace(accountId);
        });
      }
      await attempt(signOut);
      resetAccountScopedState(accountId);
      setUserState(null);
      setAccounts(listSavedAccountSessions());
      navigate("/welcome", {
        replace: true,
      });
      for (const error of failures) {
        reportSystemError({
          scope: "account:sign-out",
          title: "Part of signing out did not finish",
          error,
        });
      }
    },
    [activeUserId, navigate, signOut, setUserState, setAccounts],
  );
}
