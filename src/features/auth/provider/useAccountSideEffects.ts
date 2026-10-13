import { apiSessionInvalidEvent, readApiAuthToken } from "@/api/client/session";
import { restoreAccountWorkspace } from "@/features/workspace";
import { continueWithTemporaryWorkspace } from "@/features/workspace/nativeWorkspaceRecovery";
import { nativeWorkspaceRecoveryEnabled } from "@/features/workspace/workspaceRecoveryPlatform";
import { analytics } from "@/telemetry/client";
import { TelemetryIdentityManager } from "@/telemetry/identity";
import { setAnalyticsAuthenticationState } from "@/telemetry/lifecycle";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  assertAccountIdentity,
  clearStoredUser,
  isInvalidAccountSessionError,
  shouldPersistAuthUser,
  writeStoredUser,
  type AuthUser,
} from "../authSession";
import { restoreSavedSession } from "../sessionRecovery";
import { accountFetchMe } from "../store/useAccountStore";
import {
  listSavedAccountSessions,
  readAccountSessionGeneration,
  updateSavedAccountSession,
} from "../store/useAuthTokenStore";
import { useUserStore } from "../store/useUserStore";
import type { AccountOperation, AccountStateSetters, SetAccounts } from "./providerTypes";
import type { useDeactivateToChooser } from "./useDeactivateToChooser";

type DeactivateToChooser = ReturnType<typeof useDeactivateToChooser>;

/** Restores the native account workspace for the active account on launch. */
export function useNativeWorkspaceRecovery(
  activeUserId: string | undefined,
  accountOperationActive: MutableRefObject<boolean>,
) {
  useEffect(() => {
    if (!nativeWorkspaceRecoveryEnabled() || !activeUserId || accountOperationActive.current)
      return;
    const accountId = activeUserId;
    let canceled = false;
    void (async () => {
      // This restores the OS-held account cookies without requiring a network
      // response. Local layout recovery also works while sync is locked/offline.
      await readApiAuthToken();
      if (canceled || accountOperationActive.current) return;
      await restoreAccountWorkspace(accountId);
    })().catch((error) => {
      if (!canceled && !accountOperationActive.current)
        continueWithTemporaryWorkspace(accountId, error);
    });
    return () => {
      canceled = true;
    };
  }, [activeUserId, accountOperationActive]);
}

/** Keeps analytics identity in step with the verified account. */
export function useTelemetryIdentitySync(activeUser: AuthUser | null) {
  const verifiedAccountId = useUserStore((state) => state.me?.id);
  const [telemetryIdentity] = useState(() => new TelemetryIdentityManager(analytics));
  useEffect(() => {
    // Saved display metadata is not proof that the new server cookies work.
    // Wait for /me before issuing authenticated telemetry requests.
    const verifiedUser = activeUser?.id === verifiedAccountId ? activeUser : null;
    setAnalyticsAuthenticationState(Boolean(verifiedUser));
    telemetryIdentity.sync(verifiedUser);
  }, [activeUser, verifiedAccountId, telemetryIdentity]);
}

/** Mirrors the active user into (or out of) local storage. */
export function useStoredUserPersistence(activeUser: AuthUser | null) {
  useEffect(() => {
    if (shouldPersistAuthUser) {
      writeStoredUser(activeUser);
    } else {
      clearStoredUser();
    }
  }, [activeUser]);
}

/** Saves the active user's metadata to its saved session and refreshes the account list. */
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

/** Verifies the restored identity against /me once, signing out to the chooser if its token is dead. */
export function useStartupSessionValidation(
  activeUser: AuthUser | null,
  { accountOperationActive, beginAccountOperation, finishAccountOperation }: AccountOperation,
  { setUserState, setAccounts }: AccountStateSetters,
  deactivateToChooser: DeactivateToChooser,
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
          name: me.name,
          username: me.username,
          email: me.email,
          accountCreatedAt: me.created_at,
          currentPlan: me.tier,
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
        beginAccountOperation();
        try {
          // The restored account's token is no longer valid. Rather than silently
          // switching to a different saved account, send the user to the chooser
          // where they can pick another account or re-sign-in to this one.
          await deactivateToChooser();
        } catch {
          // A transient persistence failure must not strand the user; keep the
          // account active so the next launch can retry validation.
          await restoreSavedSession(activeUser.id);
          setUserState(activeUser);
          setAccounts(listSavedAccountSessions());
        } finally {
          finishAccountOperation();
        }
      }
    })();
    return () => {
      canceled = true;
    };
    // Validate only the first restored identity. Sign-in and account switching
    // already fetch /me before setting the user.
  }, [
    activeUser,
    accountOperationActive,
    beginAccountOperation,
    finishAccountOperation,
    deactivateToChooser,
    setUserState,
    setAccounts,
  ]);
}

/** On any API 401, re-checks /me and signs out to the chooser only if the session is truly invalid. */
export function useInvalidSessionHandling(
  activeUser: AuthUser | null,
  { accountOperationActive, beginAccountOperation, finishAccountOperation }: AccountOperation,
  deactivateToChooser: DeactivateToChooser,
) {
  useEffect(() => {
    if (!activeUser) return;
    let canceled = false;
    let validating = false;
    const handleInvalidSession = () => {
      if (canceled || validating || accountOperationActive.current) return;
      validating = true;
      const generation = readAccountSessionGeneration();
      // A delayed or resource-specific 401 is not proof that the current
      // account is signed out. Coalesce failures and validate before changing
      // identity or navigating; /me can itself emit this event.
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
          beginAccountOperation();
          try {
            await deactivateToChooser();
          } finally {
            // Deactivation cleans up this effect; still release the transition.
            finishAccountOperation();
          }
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
  }, [
    activeUser,
    accountOperationActive,
    beginAccountOperation,
    deactivateToChooser,
    finishAccountOperation,
  ]);
}
