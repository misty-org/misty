import { routes } from "@/app/shell";
import { flushWorkspaceRecovery } from "@/features/app-windows";
import { useNativeSessionStore } from "../native-session";
import {
  adoptAccountWorkspace,
  liveWorkspace,
  localAccountScope,
  accountScopeFor,
  removeAccountWorkspace,
  restoreAccountWorkspace,
  saveAccountWorkspace,
} from "@/features/app-windows";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  assertAccountIdentity,
  authUserFromMe,
  isInvalidAccountSessionError,
  resetAccountScopedState,
  type AuthUser,
} from "../sessions/auth_session";
import { tryRestoreSavedSession } from "../sessions/session_recovery";
import { accountFetchMe } from "../sessions/use_account_store";
import {
  clearAccountAuthToken,
  listSavedAccountSessions,
  updateSavedAccountSession,
} from "../sessions/use_auth_token_store";
import { useUserStore } from "../sessions/use_user_store";
import type { AccountOperation, AccountStateSetters } from "./provider_types";

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
      const previousScope = accountScopeFor(previousAccountId);
      const previousMe = useUserStore.getState().me;
      const fromLocal = !previousAccountId;
      let authenticated: AuthUser | null = null;
      if (fromLocal) authenticated = await request();
      const live = fromLocal ? liveWorkspace() : null;
      beginAccountOperation();
      try {
        await flushWorkspaceRecovery();
        await saveAccountWorkspace(previousScope);
        resetAccountScopedState(previousAccountId);
        authenticated ??= await request();
        const me = await accountFetchMe();
        assertAccountIdentity(me, authenticated.id);
        const nextUser = authUserFromMe(me, {
          ...authenticated,
          lastUsedAt: new Date().toISOString(),
        });
        await updateSavedAccountSession(nextUser);
        await saveAuthenticatedUser(nextUser);
        if (live) {
          await adoptAccountWorkspace(nextUser.id, live);
          await Promise.resolve(removeAccountWorkspace(localAccountScope)).catch(() => undefined);
        } else {
          await restoreAccountWorkspace(nextUser.id);
        }
        useUserStore.getState().setMe(me);
        setUserState(nextUser);
        setAccounts(listSavedAccountSessions());
        if (window.location.pathname.startsWith("/spaces/")) {
          navigate(routes.agents, {
            replace: true,
          });
        }
        return nextUser;
      } catch (error) {
        if (authenticated && isInvalidAccountSessionError(error)) {
          await clearAccountAuthToken();
        }
        let restoredPreviousAccount = false;
        if (await tryRestoreSavedSession(previousAccountId)) {
          try {
            if (previousUser) await saveAuthenticatedUser(previousUser);
            await restoreAccountWorkspace(previousScope);
            if (previousMe?.id === previousAccountId) useUserStore.getState().setMe(previousMe);
            if (previousUser?.id === previousAccountId) setUserState(previousUser);
            restoredPreviousAccount = true;
          } catch {}
        }
        if (!restoredPreviousAccount) {
          useUserStore.getState().clear();
          setUserState(null);
          if (live)
            await Promise.resolve(adoptAccountWorkspace(previousScope, live)).catch(
              () => undefined,
            );
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
