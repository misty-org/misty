import { useCallback, type MutableRefObject } from "react";
import { assertAccountIdentity, authUserFromMe, type AuthUser } from "../sessions/authSession";
import { accountFetchMe } from "../sessions/useAccountStore";
import {
  listSavedAccountSessions,
  readAccountSessionGeneration,
} from "../sessions/useAuthTokenStore";
import { useUserStore } from "../sessions/useUserStore";
import type { SetUserState } from "./providerTypes";

/** Re-fetches /me for the active account and updates the user, unless the session changed meanwhile. */
export function useRefreshUser(
  activeUser: AuthUser | null,
  accountOperationActive: MutableRefObject<boolean>,
  setUserState: SetUserState,
) {
  return useCallback(async (): Promise<AuthUser | null> => {
    if (!activeUser || accountOperationActive.current) return activeUser ?? null;
    const expectedAccountId = activeUser.id;
    const generation = readAccountSessionGeneration();
    const me = await accountFetchMe();
    if (readAccountSessionGeneration() !== generation) return null;
    assertAccountIdentity(me, expectedAccountId);
    const fallback = listSavedAccountSessions().find(
      (account) => account.id === expectedAccountId,
    ) ?? {
      ...activeUser,
      lastUsedAt: new Date().toISOString(),
    };
    const nextUser = authUserFromMe(me, fallback);
    useUserStore.getState().setMe(me);
    setUserState(nextUser);
    return nextUser;
  }, [activeUser, accountOperationActive, setUserState]);
}
