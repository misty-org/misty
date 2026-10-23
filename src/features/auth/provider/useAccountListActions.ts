import {
  removeAccountWorkspace,
  restoreAccountWorkspace,
  saveAccountWorkspace,
} from "@/features/workspace";
import { flushWorkspaceRecovery } from "@/features/browser-sync/recovery";
import { useCallback } from "react";
import { resetAccountScopedState, type AuthUser } from "../authSession";
import { listSavedAccountSessions, removeSavedAccountSession } from "../store/useAuthTokenStore";
import type { AccountStateSetters } from "./providerTypes";

/** `setUser` and `removeAccount`: the context's direct user and saved-list mutations. */
export function useAccountListActions(
  activeUserId: string | undefined,
  { setUserState, setAccounts }: AccountStateSetters,
) {
  const setUser = useCallback(
    async (nextUser: AuthUser | null) => {
      const currentAccountId = activeUserId ?? "";
      if (currentAccountId !== (nextUser?.id ?? "")) {
        await flushWorkspaceRecovery();
        if (currentAccountId) await saveAccountWorkspace(currentAccountId);
        resetAccountScopedState(currentAccountId);
        if (nextUser?.id) await restoreAccountWorkspace(nextUser.id);
      }
      setUserState(nextUser);
      setAccounts(listSavedAccountSessions());
    },
    [activeUserId, setUserState, setAccounts],
  );
  const removeAccount = useCallback(
    async (accountId: string) => {
      if (!(await removeSavedAccountSession(accountId)))
        throw new Error("Could not remove the saved account. Its workspace has been preserved.");
      await removeAccountWorkspace(accountId);
      setAccounts(listSavedAccountSessions());
    },
    [setAccounts],
  );
  return { setUser, removeAccount };
}
