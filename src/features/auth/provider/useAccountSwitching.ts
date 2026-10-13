import { flushWorkspaceRecovery } from "@/features/browser-workspace/recovery";
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
import { SavedAccountSessionUnavailableError } from "../sessionErrors";
import { tryRestoreSavedSession } from "../sessionRecovery";
import { accountFetchMe } from "../store/useAccountStore";
import {
  activateAccountSession,
  deactivateActiveAccount,
  listSavedAccountSessions,
  updateSavedAccountSession,
} from "../store/useAuthTokenStore";
import { useUserStore } from "../store/useUserStore";
import type { AccountOperation, AccountStateSetters } from "./providerTypes";

/** Switching between two signed-in accounts, and resuming a saved one from the chooser. */
export function useAccountSwitching(
  activeUser: AuthUser | null,
  { beginAccountOperation, finishAccountOperation }: AccountOperation,
  { setUserState, setAccounts }: AccountStateSetters,
) {
  const saveAuthenticatedUser = useNativeSessionStore((state) => state.saveAuthenticatedUser);
  const navigate = useNavigate();
  const switchAccount = useCallback(
    async (accountId: string) => {
      if (accountId === activeUser?.id) return;
      const previousUser = activeUser;
      const previousAccountId = previousUser?.id ?? "";
      const previousMe = useUserStore.getState().me;
      beginAccountOperation();
      try {
        await flushWorkspaceRecovery();
        if (previousAccountId) await saveAccountWorkspace(previousAccountId);
        resetAccountScopedState(previousAccountId);
        const saved = await activateAccountSession(accountId);
        const me = await accountFetchMe();
        assertAccountIdentity(me, saved.id);
        const nextUser = authUserFromMe(me, saved);
        // Complete fallible session persistence before committing the visible
        // and native identity. A failed write can then safely reactivate the
        // previous token without leaving the two account identities crossed.
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
      } catch (error) {
        // Keep the target account listed even when its session is dead: the
        // caller sends the person to sign in again instead of deleting it.
        const restoredPreviousAccount = await tryRestoreSavedSession(previousAccountId);
        if (restoredPreviousAccount) {
          if (previousAccountId) await restoreAccountWorkspace(previousAccountId);
          if (previousMe?.id === previousAccountId) useUserStore.getState().setMe(previousMe);
          if (previousUser?.id === previousAccountId) setUserState(previousUser);
        } else {
          await deactivateActiveAccount().catch(() => undefined);
          useUserStore.getState().clear();
          setUserState(null);
        }
        setAccounts(listSavedAccountSessions());
        throw isInvalidAccountSessionError(error)
          ? new SavedAccountSessionUnavailableError()
          : error;
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

  // Resume a saved account chosen from the sign-in screen. Its token is validated
  // against /me; on failure the account stays listed and the error propagates so
  // the chooser can send the person to re-sign-in.
  const resumeAccount = useCallback(
    async (accountId: string) => {
      beginAccountOperation();
      const previousAccountId = activeUser?.id ?? "";
      try {
        await flushWorkspaceRecovery();
        if (previousAccountId) await saveAccountWorkspace(previousAccountId);
        resetAccountScopedState(previousAccountId);
        const saved = await activateAccountSession(accountId);
        const me = await accountFetchMe();
        assertAccountIdentity(me, saved.id);
        const nextUser = authUserFromMe(me, saved);
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
      } catch (error) {
        // Keep the account listed so transient failures can be retried. Only
        // confirmed invalid sessions should send the chooser to password entry.
        await deactivateActiveAccount().catch(() => undefined);
        setAccounts(listSavedAccountSessions());
        throw isInvalidAccountSessionError(error)
          ? new SavedAccountSessionUnavailableError()
          : error;
      } finally {
        finishAccountOperation();
      }
    },
    [
      activeUser?.id,
      beginAccountOperation,
      finishAccountOperation,
      navigate,
      saveAuthenticatedUser,
      setUserState,
      setAccounts,
    ],
  );
  return { switchAccount, resumeAccount };
}
