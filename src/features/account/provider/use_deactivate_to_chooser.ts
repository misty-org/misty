import { flushWorkspaceRecovery } from "@/features/app-windows";
import { useNativeSessionStore } from "../native-session";
import { routes } from "@/app/shell";
import { deviceDataErasers } from "../account_seams";
import {
  localAccountScope,
  removeAccountWorkspace,
  restoreAccountWorkspace,
  saveAccountWorkspace,
} from "@/features/app-windows";
import { reportSystemError } from "@/shared/platform/system_errors";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { resetAccountScopedState } from "../sessions/auth_session";
import { accountLogout } from "../sessions/use_account_store";
import {
  deactivateActiveAccount,
  listSavedAccountSessions,
  removeSavedAccountSession,
} from "../sessions/use_auth_token_store";
import type { AccountStateSetters } from "./provider_types";

async function eraseDeviceBrowsingData() {
  await deviceDataErasers.runAsync();
  await removeAccountWorkspace(localAccountScope);
}

export function useDeactivateToChooser(
  activeUserId: string | undefined,
  { setUserState, setAccounts }: AccountStateSetters,
) {
  const signOut = useNativeSessionStore((state) => state.signOut);
  const navigate = useNavigate();
  return useCallback(
    async ({
      endSession = false,
      removeData = false,
    }: {
      endSession?: boolean;
      removeData?: boolean;
    } = {}) => {
      const accountId = activeUserId ?? "";
      const failures: unknown[] = [];
      const attempt = async (step: () => unknown) => {
        try {
          await step();
        } catch (error) {
          failures.push(error);
        }
      };
      await attempt(flushWorkspaceRecovery);
      if (accountId && !endSession) await attempt(() => saveAccountWorkspace(accountId));
      if (removeData) await attempt(eraseDeviceBrowsingData);
      if (endSession && accountId) await attempt(() => accountLogout(accountId));
      await attempt(deactivateActiveAccount);
      if (endSession && accountId) {
        await attempt(async () => {
          if (!(await removeSavedAccountSession(accountId)))
            throw new Error("Could not remove the saved account.");
          await removeAccountWorkspace(accountId);
        });
      }
      await attempt(signOut);
      resetAccountScopedState(accountId);
      await attempt(() => restoreAccountWorkspace(localAccountScope));
      setUserState(null);
      setAccounts(listSavedAccountSessions());
      navigate(routes.signIn, { replace: true });
      for (const error of failures) {
        reportSystemError({
          scope: "account:sign-out",
          title: "Part of signing out did not finish",
          error,
        });
      }
    },
    [activeUserId, navigate, signOut, setUserState, setAccounts],
  );
}
