import {
  accountLimitMessages,
  useAccountNotSetUp,
  useAccountSuspension,
} from "@/api/client/account_limits";
import { createDeviceSetting } from "@/shared/lib/device_setting";
import { useNotice } from "@misty/ui";
import { useEffect } from "react";
import { useAuth } from "../sessions/auth_state";

const keptAccounts = 200;

const useDismissedNotices = createDeviceSetting<Record<string, number>>({
  scope: "account-limit-notices",
  defaults: {},
  normalize: (stored) =>
    typeof stored === "object" && stored !== null
      ? Object.fromEntries(Object.entries(stored).filter(([, at]) => typeof at === "number"))
      : {},
});

function rememberDismissed(accountId: string, dismissed: boolean) {
  useDismissedNotices.getState().set((current) => {
    const next = { ...current };
    delete next[accountId];
    if (!dismissed) return next;
    next[accountId] = Date.now();
    const newest = Object.entries(next)
      .sort(([, a], [, b]) => b - a)
      .slice(0, keptAccounts);
    return Object.fromEntries(newest);
  });
}

const legacyKey = (accountId: string) => `misty.account-not-set-up.dismissed.${accountId}`;

function legacyDismissed(accountId: string) {
  try {
    return localStorage.getItem(legacyKey(accountId)) === "1";
  } catch {
    return false;
  }
}

function forgetLegacy(accountId: string) {
  try {
    localStorage.removeItem(legacyKey(accountId));
  } catch {}
}

export function AccountSuspendedNotice() {
  const suspended = useAccountSuspension((state) => state.suspended);
  const notSetUp = useAccountNotSetUp((state) => state.notSetUp);
  const { user } = useAuth();
  const accountId = user?.id;
  const loaded = useDismissedNotices((state) => state.loaded);
  const dismissed = useDismissedNotices((state) =>
    accountId ? accountId in state.value || legacyDismissed(accountId) : false,
  );
  useEffect(() => {
    if (!accountId || !loaded || !legacyDismissed(accountId)) return;
    rememberDismissed(accountId, true);
    forgetLegacy(accountId);
  }, [accountId, loaded]);
  const hasDevices = useAccountNotSetUp((state) => state.hasDevices);
  useEffect(() => {
    if (!accountId || !hasDevices || !dismissed) return;
    rememberDismissed(accountId, false);
    forgetLegacy(accountId);
  }, [accountId, hasDevices, dismissed]);
  const dismiss = () => {
    if (accountId) rememberDismissed(accountId, true);
  };
  useNotice(Boolean(user) && loaded && !suspended && notSetUp && !dismissed, {
    message: accountLimitMessages.no_devices_allowed,
    onDismiss: dismiss,
  });
  useNotice(Boolean(user) && suspended, {
    message: accountLimitMessages.account_suspended,
    tone: "error",
    onDismiss: () => useAccountSuspension.setState({ suspended: false }),
  });
  return null;
}
