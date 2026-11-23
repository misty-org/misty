import { useNativeSessionStore } from "./native-session";
import { accountScopeFor } from "@/features/app-windows";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { readInitialUser, type AuthUser } from "./sessions/auth_session";
import type { SavedAccountSession } from "./sessions/account_vault";
import { useAccountListActions } from "./provider/use_account_list_actions";
import { useAccountOperation } from "./provider/use_account_operation";
import {
  useInvalidSessionHandling,
  useNativeWorkspaceRecovery,
  useSavedAccountListSync,
  useStartupSessionValidation,
  useStoredUserPersistence,
} from "./provider/use_account_side_effects";
import { useAccountSwitching } from "./provider/use_account_switching";
import { useAuthenticateAccount } from "./provider/use_authenticate_account";
import { useDeactivateToChooser } from "./provider/use_deactivate_to_chooser";
import { useLogout } from "./provider/use_logout";
import { useRefreshUser } from "./provider/use_refresh_user";
import { listSavedAccountSessions } from "./sessions/use_auth_token_store";
import { useUserStore } from "./sessions/use_user_store";
export type { AuthContextValue, AuthUser } from "./sessions/auth_session";
import { AuthContext } from "./sessions/auth_state";
export { useAuth } from "./sessions/auth_state";
export function AuthProvider({ children }: { children: ReactNode }) {
  const nativeUser = useNativeSessionStore((state) => state.status?.current_user ?? null);
  const [user, setUserState] = useState<AuthUser | null>(() => {
    const initial = readInitialUser();
    useUserStore.getState().setAccountId(initial?.id ?? "");
    return initial;
  });
  const [accounts, setAccounts] = useState<SavedAccountSession[]>(() => listSavedAccountSessions());
  const activeUser = user ?? nativeUser;
  useLayoutEffect(
    () => useUserStore.getState().setAccountId(activeUser?.id ?? ""),
    [activeUser?.id],
  );
  const [sessionExpired, setSessionExpired] = useState(false);
  const markSessionExpired = useCallback(() => setSessionExpired(true), []);
  useEffect(() => setSessionExpired(false), [user]);
  const [outletKey, setOutletKey] = useState(() => accountScopeFor(activeUser?.id));
  const previousUserId = useRef(activeUser?.id);
  useEffect(() => {
    const previous = previousUserId.current;
    const next = activeUser?.id;
    previousUserId.current = next;
    if (previous && next && previous !== next) setOutletKey(next);
  }, [activeUser?.id]);
  const operation = useAccountOperation();
  const { transitioning, accountOperationActive } = operation;
  const setters = { setUserState, setAccounts };
  const deactivateToChooser = useDeactivateToChooser(activeUser?.id, setters);
  const { setUser, removeAccount } = useAccountListActions(activeUser?.id, setters);
  const { switchAccount, resumeAccount } = useAccountSwitching(activeUser, operation, setters);
  const authenticateAccount = useAuthenticateAccount(activeUser, operation, setters);
  const refreshUser = useRefreshUser(activeUser, accountOperationActive, setUserState);
  useNativeWorkspaceRecovery(activeUser?.id, accountOperationActive);
  useStoredUserPersistence(activeUser);
  useSavedAccountListSync(activeUser, setAccounts);
  useStartupSessionValidation(activeUser, operation, setters, markSessionExpired);
  useInvalidSessionHandling(activeUser, sessionExpired, operation, markSessionExpired);
  const logout = useLogout(operation, deactivateToChooser);
  const fields = {
    user: activeUser,
    setUser,
    accounts,
    transitioning,
    sessionExpired,
    outletKey,
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
