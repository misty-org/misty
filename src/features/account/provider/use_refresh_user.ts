import { useCallback, type MutableRefObject } from "react";
import { assertAccountIdentity, authUserFromMe, type AuthUser } from "../sessions/auth_session";
import { accountFetchMe } from "../sessions/use_account_store";
import {
  listSavedAccountSessions,
  readAccountSessionGeneration,
} from "../sessions/use_auth_token_store";
import { useUserStore } from "../sessions/use_user_store";
import type { SetUserState } from "./provider_types";

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
