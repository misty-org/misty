import {
  accountLimitMessages,
  useAccountNotSetUp,
  useAccountSuspension,
} from "@/api/client/accountLimits";
import { currentApiBase, mistyCloudServer, mistyWebsite } from "@/api/deployment/serverChoice";
import { useNotice } from "@/shared/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { useAuth } from "../sessions/authState";

const dismissedKey = (accountId: string) => `misty.account-not-set-up.dismissed.${accountId}`;

/** Whether this computer has already been told, so it doesn't say so on every launch. */
function wasDismissed(accountId: string) {
  try {
    return localStorage.getItem(dismissedKey(accountId)) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed(accountId: string, dismissed: boolean) {
  try {
    if (dismissed) localStorage.setItem(dismissedKey(accountId), "1");
    else localStorage.removeItem(dismissedKey(accountId));
  } catch {
    // Without storage the notice just comes back next launch.
  }
}

/**
 * The server said the signed-in account is suspended (403 `account_suspended`). Browsing on
 * this device carries on; sync, Spaces and agents wait. The notice stays until dismissed, and
 * returns if the server says so again after a fresh sign-in attempt. An account allowed no
 * devices yet gets the same treatment: on Misty's server, the way to Misty Pro. That one is said once per account: Settings › Sync says
 * it too, and an account that gets devices and later loses them is told again.
 */
export function AccountSuspendedNotice() {
  const suspended = useAccountSuspension((state) => state.suspended);
  const notSetUp = useAccountNotSetUp((state) => state.notSetUp);
  const { user } = useAuth();
  const accountId = user?.id;
  // Read at once, so a notice already dismissed on this computer never flashes up.
  const [dismissed, setDismissed] = useState(() => (accountId ? wasDismissed(accountId) : false));
  useEffect(() => {
    if (!accountId) return;
    setDismissed(wasDismissed(accountId));
  }, [accountId]);
  const hasDevices = useAccountNotSetUp((state) => state.hasDevices);
  useEffect(() => {
    if (accountId && hasDevices) rememberDismissed(accountId, false);
  }, [accountId, hasDevices]);
  const dismiss = () => {
    if (accountId) rememberDismissed(accountId, true);
    setDismissed(true);
  };
  const onCloud = currentApiBase() === mistyCloudServer();
  useNotice(Boolean(user) && !suspended && notSetUp && !dismissed, {
    message: onCloud
      ? "This account doesn't have Misty Pro."
      : "This account isn't set up yet. Ask whoever runs your Misty server.",
    action: onCloud
      ? { label: "Get Misty Pro", onSelect: () => void openUrl(`${mistyWebsite()}/pricing`) }
      : undefined,
    onDismiss: dismiss,
  });
  useNotice(Boolean(user) && suspended, {
    message: accountLimitMessages.account_suspended,
    tone: "error",
    onDismiss: () => useAccountSuspension.setState({ suspended: false }),
  });
  return null;
}
