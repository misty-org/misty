import { apiSessionInvalidEvent, readApiAuthToken } from "@/api/client/session";
import { isLocalProfile, profileIdFor, restoreAccountWorkspace } from "@/features/workspace";
import { continueWithTemporaryWorkspace } from "@/features/workspace/nativeWorkspaceRecovery";
import { nativeWorkspaceRecoveryEnabled } from "@/features/workspace/workspaceRecoveryPlatform";
import { analytics } from "@/telemetry/client";
import { TelemetryIdentityManager } from "@/telemetry/identity";
import { setAnalyticsAuthenticationState, setTelemetryAccountPresent } from "@/telemetry/lifecycle";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  assertAccountIdentity,
  clearStoredUser,
  isInvalidAccountSessionError,
  shouldPersistAuthUser,
  writeStoredUser,
  type AuthUser,
} from "../authSession";
import { accountFetchMe } from "../store/useAccountStore";
import {
  listSavedAccountSessions,
  readAccountSessionGeneration,
  updateSavedAccountSession,
} from "../store/useAuthTokenStore";
import { useUserStore } from "../store/useUserStore";
import type { AccountOperation, AccountStateSetters, SetAccounts } from "./providerTypes";

/** Restores the native workspace on launch: the active account's, or the local profile's
 * while nobody is signed in. */
export function useNativeWorkspaceRecovery(
  activeUserId: string | undefined,
  accountOperationActive: MutableRefObject<boolean>,
) {
  useEffect(() => {
    if (!nativeWorkspaceRecoveryEnabled() || accountOperationActive.current) return;
    const profileId = profileIdFor(activeUserId);
    let canceled = false;
    void (async () => {
      // This restores the OS-held account cookies without requiring a network
      // response. Local layout recovery also works while sync is locked/offline.
      // The local profile has no account cookies.
      if (!isLocalProfile(profileId)) await readApiAuthToken();
      if (canceled || accountOperationActive.current) return;
      await restoreAccountWorkspace(profileId);
    })().catch((error) => {
      if (!canceled && !accountOperationActive.current)
        continueWithTemporaryWorkspace(profileId, error);
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
  // Without an account nothing is sent at all.
  useEffect(() => setTelemetryAccountPresent(Boolean(activeUser)), [activeUser]);
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

/** Verifies the restored identity against /me once. A dead token no longer signs anyone
 * out: browsing carries on, and the account asks to be signed in again. */
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
        // The restored account's token is no longer valid. Rather than signing out or
        // switching to another saved account, keep the window as it is; the account row
        // offers to sign in again.
        markSessionExpired();
      }
    })();
    return () => {
      canceled = true;
    };
    // Validate only the first restored identity. Sign-in and account switching
    // already fetch /me before setting the user.
  }, [activeUser, accountOperationActive, markSessionExpired, setUserState]);
}

/** On any API 401, re-checks /me and marks the session expired only if it truly is. */
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
      // A delayed or resource-specific 401 is not proof that the current
      // account is signed out. Coalesce failures and validate before changing
      // anything; /me can itself emit this event.
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
          // Browsing carries on; sync and agents wait until the person signs in again.
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
