import {
  accountLimitMessages,
  useAccountNotSetUp,
  useAccountSuspension,
} from "@/api/client/accountLimits";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { useNotice } from "@/shared/ui";
import { useEffect } from "react";
import { useAuth } from "../sessions/authState";

/** Accounts remembered at most; past it the oldest dismissal is forgotten. */
const keptAccounts = 200;

/**
 * Accounts this computer has already told they reached a limit, with when, so it doesn't say so
 * on every launch. Kept for this device in `misty.db`, keyed by account.
 */
const dismissedNotices = createDeviceSetting<Record<string, number>>({
  scope: "account-limit-notices",
  defaults: {},
  normalize: (stored) =>
    typeof stored === "object" && stored !== null
      ? Object.fromEntries(Object.entries(stored).filter(([, at]) => typeof at === "number"))
      : {},
});

function rememberDismissed(accountId: string, dismissed: boolean) {
  dismissedNotices.getState().set((current) => {
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

/** Older builds kept the dismissal in the webview's storage, one key per account. */
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
  } catch {
    // It stays counted from the old key until storage works again.
  }
}

/**
 * The server said the signed-in account is suspended (403 `account_suspended`). Agents on this
 * computer carry on; Spaces wait. The notice stays until dismissed, and returns if the server says
 * so again after a fresh sign-in attempt. An account allowed no devices yet is told it reached a
 * limit, once per account; one that gets devices and later loses them is told again.
 */
export function AccountSuspendedNotice() {
  const suspended = useAccountSuspension((state) => state.suspended);
  const notSetUp = useAccountNotSetUp((state) => state.notSetUp);
  const { user } = useAuth();
  const accountId = user?.id;
  const loaded = dismissedNotices((state) => state.loaded);
  // The old copy counts too, so a notice already dismissed on this computer never flashes up.
  const dismissed = dismissedNotices((state) =>
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
