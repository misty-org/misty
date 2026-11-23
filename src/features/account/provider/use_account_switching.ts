import { routes } from "@/app/shell";
import { flushWorkspaceRecovery } from "@/features/app-windows";
import { useNativeSessionStore } from "../native-session";
import { restoreAccountWorkspace, saveAccountWorkspace } from "@/features/app-windows";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  assertAccountIdentity,
  authUserFromMe,
  isInvalidAccountSessionError,
  resetAccountScopedState,
  type AuthUser,
} from "../sessions/auth_session";
import { SavedAccountSessionUnavailableError } from "../sessions/session_errors";
import { tryRestoreSavedSession } from "../sessions/session_recovery";
import { accountFetchMe } from "../sessions/use_account_store";
import {
  activateAccountSession,
  deactivateActiveAccount,
  listSavedAccountSessions,
  updateSavedAccountSession,
} from "../sessions/use_auth_token_store";
import { useUserStore } from "../sessions/use_user_store";
import type { AccountOperation, AccountStateSetters } from "./provider_types";

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
        await updateSavedAccountSession(nextUser);
        await saveAuthenticatedUser(nextUser);
        await restoreAccountWorkspace(nextUser.id);
        useUserStore.getState().setMe(me);
        setUserState(nextUser);
        setAccounts(listSavedAccountSessions());
        if (window.location.pathname.startsWith("/spaces/")) {
          navigate(routes.agents, {
            replace: true,
          });
        }
      } catch (error) {
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
        await saveAuthenticatedUser(nextUser);
        await restoreAccountWorkspace(nextUser.id);
        useUserStore.getState().setMe(me);
        setUserState(nextUser);
        setAccounts(listSavedAccountSessions());
        if (window.location.pathname.startsWith("/spaces/")) {
          navigate(routes.agents, {
            replace: true,
          });
        }
      } catch (error) {
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
