import { accountLimitMessages, useAccountSuspension } from "@/api/client/accountLimits";
import { Notification } from "@/shared/ui";
import { useAuth } from "./authState";

/**
 * The server said the signed-in account is suspended (403 `account_suspended`). Browsing on
 * this device carries on; sync, Spaces and agents wait. The notice stays until dismissed, and
 * returns if the server says so again after a fresh sign-in attempt.
 */
export function AccountSuspendedNotice() {
  const suspended = useAccountSuspension((state) => state.suspended);
  const { user } = useAuth();
  if (!suspended || !user) return null;
  return (
    <Notification
      tone="error"
      onDismiss={() => useAccountSuspension.setState({ suspended: false })}
    >
      {accountLimitMessages.account_suspended}
    </Notification>
  );
}
