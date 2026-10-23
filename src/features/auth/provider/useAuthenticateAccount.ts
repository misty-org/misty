import { flushWorkspaceRecovery } from "@/features/browser-sync/recovery";
import { useNativeSessionStore } from "@/features/native-session";
import { restoreAccountWorkspace, saveAccountWorkspace } from "@/features/workspace";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  assertAccountIdentity,
  authUserFromMe,
  isInvalidAccountSessionError,
  licenseFromMe,
  resetAccountScopedState,
  type AuthUser,
} from "../authSession";
import { tryRestoreSavedSession } from "../sessionRecovery";
import { accountFetchMe } from "../store/useAccountStore";
import {
  clearAccountAuthToken,
  listSavedAccountSessions,
  updateSavedAccountSession,
} from "../store/useAuthTokenStore";
import { useUserStore } from "../store/useUserStore";
import type { AccountOperation, AccountStateSetters } from "./providerTypes";

/** Runs a sign-in request, verifies the identity it produced, and rolls back to the previous account on failure. */
export function useAuthenticateAccount(
  activeUser: AuthUser | null,
  { beginAccountOperation, finishAccountOperation }: AccountOperation,
  { setUserState, setAccounts }: AccountStateSetters,
) {
  const saveAuthenticatedUser = useNativeSessionStore((state) => state.saveAuthenticatedUser);
  const navigate = useNavigate();
  return useCallback(
    async (request: () => Promise<AuthUser>) => {
      const previousUser = activeUser;
      const previousAccountId = previousUser?.id ?? "";
      const previousMe = useUserStore.getState().me;
      const previousLicense = useNativeSessionStore.getState().status?.current_license ?? null;
      let authenticated: AuthUser | null = null;
      beginAccountOperation();
      try {
        await flushWorkspaceRecovery();
        if (previousAccountId) await saveAccountWorkspace(previousAccountId);
        resetAccountScopedState(previousAccountId);
        authenticated = await request();
        const me = await accountFetchMe();
        assertAccountIdentity(me, authenticated.id);
        const nextUser = authUserFromMe(me, {
          ...authenticated,
          lastUsedAt: new Date().toISOString(),
        });
        await updateSavedAccountSession(nextUser);
        await saveAuthenticatedUser(nextUser, licenseFromMe(me));
        await restoreAccountWorkspace(nextUser.id);
        useUserStore.getState().setMe(me);
        setUserState(nextUser);
        setAccounts(listSavedAccountSessions());
        if (window.location.pathname.startsWith("/spaces/")) {
          navigate("/browser", {
            replace: true,
          });
        }
        return nextUser;
      } catch (error) {
        // A 401 from /me after login means the newly stored token is invalid.
        // A 401 from the login request itself must leave the current account
        // untouched, so only clear after the request produced an identity.
        if (authenticated && isInvalidAccountSessionError(error)) {
          await clearAccountAuthToken();
        }
        let restoredPreviousAccount = false;
        if (await tryRestoreSavedSession(previousAccountId)) {
          try {
            if (previousUser && previousLicense) {
              await saveAuthenticatedUser(previousUser, previousLicense);
            }
            if (previousAccountId) await restoreAccountWorkspace(previousAccountId);
            if (previousMe?.id === previousAccountId) useUserStore.getState().setMe(previousMe);
            if (previousUser?.id === previousAccountId) setUserState(previousUser);
            restoredPreviousAccount = true;
          } catch {
            // Restoring the previous native identity is best-effort. Preserve
            // the original sign-in error instead of replacing it with a
            // secondary rollback failure.
          }
        }
        if (!restoredPreviousAccount) {
          useUserStore.getState().clear();
          setUserState(null);
        }
        setAccounts(listSavedAccountSessions());
        throw error;
      } finally {
        finishAccountOperation();
      }
    },
    [
      activeUser,
      beginAccountOperation,
      finishAccountOperation,
      navigate,
      saveAuthenticatedUser,
      setUserState,
      setAccounts,
    ],
  );
}
