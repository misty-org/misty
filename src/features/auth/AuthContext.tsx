import { useNativeSessionStore } from "@/features/native-session";
import { useMemo, useState, type ReactNode } from "react";
import { readInitialUser, type AuthUser } from "./authSession";
import type { SavedAccountSession } from "./model/stores/account/interfaces/useAuthTokenStore";
import { useAccountListActions } from "./provider/useAccountListActions";
import { useAccountOperation } from "./provider/useAccountOperation";
import {
  useInvalidSessionHandling,
  useNativeWorkspaceRecovery,
  useSavedAccountListSync,
  useStartupSessionValidation,
  useStoredUserPersistence,
  useTelemetryIdentitySync,
} from "./provider/useAccountSideEffects";
import { useAccountSwitching } from "./provider/useAccountSwitching";
import { useAuthenticateAccount } from "./provider/useAuthenticateAccount";
import { useDeactivateToChooser } from "./provider/useDeactivateToChooser";
import { useLogout } from "./provider/useLogout";
import { useRefreshUser } from "./provider/useRefreshUser";
import { listSavedAccountSessions } from "./store/useAuthTokenStore";
export type { AuthContextValue, AuthUser } from "./authSession";
import { AuthContext } from "./authState";
// Preserve the public import path without recreating the context during provider refreshes.
export { useAuth } from "./authState";
export function AuthProvider({ children }: { children: ReactNode }) {
  const nativeUser = useNativeSessionStore((state) => state.status?.current_user ?? null);
  const [user, setUserState] = useState<AuthUser | null>(() => readInitialUser());
  const [accounts, setAccounts] = useState<SavedAccountSession[]>(() => listSavedAccountSessions());
  const activeUser = user ?? nativeUser;
  const operation = useAccountOperation();
  const { transitioning, accountOperationActive } = operation;
  const setters = { setUserState, setAccounts };
  const deactivateToChooser = useDeactivateToChooser(activeUser?.id, setters);
  const { setUser, removeAccount } = useAccountListActions(activeUser?.id, setters);
  const { switchAccount, resumeAccount } = useAccountSwitching(activeUser, operation, setters);
  const authenticateAccount = useAuthenticateAccount(activeUser, operation, setters);
  const refreshUser = useRefreshUser(activeUser, accountOperationActive, setUserState);
  useNativeWorkspaceRecovery(activeUser?.id, accountOperationActive);
  useTelemetryIdentitySync(activeUser);
  useStoredUserPersistence(activeUser);
  useSavedAccountListSync(activeUser, setAccounts);
  useStartupSessionValidation(activeUser, operation, setters, deactivateToChooser);
  useInvalidSessionHandling(activeUser, operation, deactivateToChooser);
  const logout = useLogout(operation, deactivateToChooser);
  const fields = {
    user: activeUser,
    setUser,
    accounts,
    transitioning,
    refreshUser,
    authenticateAccount,
    switchAccount,
    resumeAccount,
    removeAccount,
    logout,
  };
  // A fresh value object would re-render every useAuth consumer whenever the provider
  // renders, so it changes only when one of its fields does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => fields, Object.values(fields));
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
