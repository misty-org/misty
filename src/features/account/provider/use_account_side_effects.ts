import { apiSessionInvalidEvent, readApiAuthToken } from "@/api/client/session";
import {
  accountScopeFor,
  isLocalAccountScope,
  restoreAccountWorkspace,
} from "@/features/app-windows";
import { continueWithTemporaryWorkspace } from "@/features/app-windows";
import { nativeWorkspaceRecoveryEnabled } from "@/features/app-windows";
import { useEffect, useRef, type MutableRefObject } from "react";
import {
  assertAccountIdentity,
  clearStoredUser,
  isInvalidAccountSessionError,
  shouldPersistAuthUser,
  writeStoredUser,
  type AuthUser,
} from "../sessions/auth_session";
import { accountFetchMe } from "../sessions/use_account_store";
import {
  listSavedAccountSessions,
  readAccountSessionGeneration,
  updateSavedAccountSession,
} from "../sessions/use_auth_token_store";
import { useUserStore } from "../sessions/use_user_store";
import type { AccountOperation, AccountStateSetters, SetAccounts } from "./provider_types";

export function useNativeWorkspaceRecovery(
  activeUserId: string | undefined,
  accountOperationActive: MutableRefObject<boolean>,
) {
  useEffect(() => {
    if (!nativeWorkspaceRecoveryEnabled() || accountOperationActive.current) return;
    const accountScope = accountScopeFor(activeUserId);
    let canceled = false;
    void (async () => {
      if (!isLocalAccountScope(accountScope)) await readApiAuthToken();
      if (canceled || accountOperationActive.current) return;
      await restoreAccountWorkspace(accountScope);
    })().catch((error) => {
      if (!canceled && !accountOperationActive.current)
        continueWithTemporaryWorkspace(accountScope, error);
    });
    return () => {
      canceled = true;
    };
  }, [activeUserId, accountOperationActive]);
}

export function useStoredUserPersistence(activeUser: AuthUser | null) {
  useEffect(() => {
    if (shouldPersistAuthUser) {
      writeStoredUser(activeUser);
    } else {
      clearStoredUser();
    }
  }, [activeUser]);
}

export function useSavedAccountListSync(activeUser: AuthUser | null, setAccounts: SetAccounts) {
  useEffect(() => {
    if (!activeUser) {
      setAccounts(listSavedAccountSessions());
      return;
    }
    void updateSavedAccountSession(activeUser)
      .then(() => setAccounts(listSavedAccountSessions()))
      .catch(() => undefined);
  }, [activeUser, setAccounts]);
}

export function useStartupSessionValidation(
  activeUser: AuthUser | null,
  { accountOperationActive }: AccountOperation,
  { setUserState }: AccountStateSetters,
  markSessionExpired: () => void,
) {
  const startupValidationCompleted = useRef(false);
  useEffect(() => {
    if (!activeUser || startupValidationCompleted.current || accountOperationActive.current) return;
    let canceled = false;
    const validationGeneration = readAccountSessionGeneration();
    void (async () => {
      try {
        const me = await accountFetchMe();
        if (canceled || readAccountSessionGeneration() !== validationGeneration) return;
        assertAccountIdentity(me, activeUser.id);
        startupValidationCompleted.current = true;
        useUserStore.getState().setMe(me);
        setUserState((current) => ({
          ...(current ?? activeUser),
          id: me.id,
          username: me.username,
          email: me.email,
          accountCreatedAt: me.created_at,
        }));
      } catch (error) {
        if (
          canceled ||
          readAccountSessionGeneration() !== validationGeneration ||
          !isInvalidAccountSessionError(error) ||
          accountOperationActive.current
        ) {
          return;
        }
        startupValidationCompleted.current = true;
        markSessionExpired();
      }
    })();
    return () => {
      canceled = true;
    };
  }, [activeUser, accountOperationActive, markSessionExpired, setUserState]);
}

export function useInvalidSessionHandling(
  activeUser: AuthUser | null,
  sessionExpired: boolean,
  { accountOperationActive }: AccountOperation,
  markSessionExpired: () => void,
) {
  useEffect(() => {
    if (!activeUser || sessionExpired) return;
    let canceled = false;
    let validating = false;
    const handleInvalidSession = () => {
      if (canceled || validating || accountOperationActive.current) return;
      validating = true;
      const generation = readAccountSessionGeneration();
      void (async () => {
        try {
          const me = await accountFetchMe();
          if (canceled || readAccountSessionGeneration() !== generation) return;
          assertAccountIdentity(me, activeUser.id);
        } catch (error) {
          if (
            canceled ||
            accountOperationActive.current ||
            readAccountSessionGeneration() !== generation ||
            !isInvalidAccountSessionError(error)
          )
            return;
          markSessionExpired();
        } finally {
          validating = false;
        }
      })().catch(() => undefined);
    };
    window.addEventListener(apiSessionInvalidEvent, handleInvalidSession);
    return () => {
      canceled = true;
      window.removeEventListener(apiSessionInvalidEvent, handleInvalidSession);
    };
  }, [activeUser, sessionExpired, accountOperationActive, markSessionExpired]);
}
