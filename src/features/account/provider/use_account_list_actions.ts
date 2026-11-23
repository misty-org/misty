import {
  removeAccountWorkspace,
  restoreAccountWorkspace,
  saveAccountWorkspace,
} from "@/features/app-windows";
import { flushWorkspaceRecovery } from "@/features/app-windows";
import { useCallback } from "react";
import { resetAccountScopedState, type AuthUser } from "../sessions/auth_session";
import {
  listSavedAccountSessions,
  removeSavedAccountSession,
} from "../sessions/use_auth_token_store";
import type { AccountStateSetters } from "./provider_types";

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
