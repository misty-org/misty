import { flushWorkspaceRecovery } from "@/features/browser-sync/recovery";
import { useNativeSessionStore } from "@/features/native-session";
import { routes } from "@/features/app-shell";
import { browserLibrary } from "@/features/browser";
import { passwordsApi } from "@/features/passwords/api";
import {
  adoptAccountWorkspace,
  liveWorkspace,
  localProfileId,
  removeAccountWorkspace,
  restoreAccountWorkspace,
  saveAccountWorkspace,
} from "@/features/workspace";
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

// Signs out the active account without silently jumping to another saved account. The
// window keeps browsing with the local profile's windows and tabs, as Misty works without an
// account. Other saved accounts stay listed; ending the session (logging out) also removes
// the account itself.
// Saving the workspace and clearing native identity are best-effort: a failed
// cleanup step is reported, but never leaves the person signed in.
/** "Also remove my browsing data from this device": history, downloads, website sign-ins
 * and cached files of the personal Space, and the local profile's saved windows and tabs. */
async function eraseDeviceBrowsingData() {
  await browserLibrary.clearHistory({ since: 0 });
  await browserLibrary.removeDownloads({ since: 0 });
  await browserLibrary.clearWebsiteData({ kinds: ["cookies", "cache"], since: 0 });
  await removeAccountWorkspace(localProfileId);
}

export function useDeactivateToChooser(
  activeUserId: string | undefined,
  { setUserState, setAccounts }: AccountStateSetters,
) {
  const signOut = useNativeSessionStore((state) => state.signOut);
  const navigate = useNavigate();
  return useCallback(
    async ({
      endSession = false,
      removeData = false,
    }: {
      endSession?: boolean;
      /** Erase this device's browsing data instead of keeping it for browsing without an
       * account. The account keeps its synced copy. */
      removeData?: boolean;
    } = {}) => {
      const accountId = activeUserId ?? "";
      // The windows and tabs on screen go back to the local profile, unless they're erased.
      const live = removeData ? null : liveWorkspace();
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
      // While the account's vault is still open: keep its saved passwords on this device for
      // browsing without an account, or erase the device's.
      await attempt(() => passwordsApi.deviceKeep(removeData));
      if (removeData) await attempt(eraseDeviceBrowsingData);
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
      await attempt(() =>
        live
          ? adoptAccountWorkspace(localProfileId, live)
          : restoreAccountWorkspace(localProfileId),
      );
      setUserState(null);
      setAccounts(listSavedAccountSessions());
      navigate(routes.browser, {
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
