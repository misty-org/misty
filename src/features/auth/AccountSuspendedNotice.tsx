import {
  accountLimitMessages,
  useAccountNotSetUp,
  useAccountSuspension,
} from "@/api/client/accountLimits";
import { currentApiBase, mistyProServer, mistyWebsite } from "@/api/deployment/serverChoice";
import { Button, Notification } from "@/shared/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { useAuth } from "./authState";

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
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!accountId) return;
    setDismissed(wasDismissed(accountId));
  }, [accountId]);
  const hasDevices = useAccountNotSetUp((state) => state.hasDevices);
  useEffect(() => {
    if (accountId && hasDevices) rememberDismissed(accountId, false);
  }, [accountId, hasDevices]);
  if (!user) return null;
  const dismiss = () => {
    rememberDismissed(user.id, true);
    setDismissed(true);
  };
  if (!suspended) {
    if (!notSetUp || dismissed) return null;
    return currentApiBase() === mistyProServer() ? (
      <Notification onDismiss={dismiss}>
        This account doesn&apos;t have Misty Pro.
        <br />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void openUrl(`${mistyWebsite()}/pricing`)}
        >
          Get Misty Pro
        </Button>
      </Notification>
    ) : (
      <Notification onDismiss={dismiss}>
        This account isn&apos;t set up yet. Ask whoever runs your Misty server.
      </Notification>
    );
  }
  return (
    <Notification
      tone="error"
      onDismiss={() => useAccountSuspension.setState({ suspended: false })}
    >
      {accountLimitMessages.account_suspended}
    </Notification>
  );
}
