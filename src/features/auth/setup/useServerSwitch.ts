import { probeServer } from "@/api/deployment/probe";
import { currentApiBase, saveServerChoice } from "@/api/deployment/serverChoice";
import { useAuth } from "../authState";
import { useCallback } from "react";

/**
 * Moves this device to another Misty server, or to none. Accounts belong to their server, so
 * leaving one signs out of it and forgets its saved accounts; browsing stays as it is.
 */
export function useServerSwitch() {
  const { user, accounts, logout, removeAccount } = useAuth();
  const leave = useCallback(async () => {
    if (user) await logout();
    for (const account of accounts) {
      if (account.id !== user?.id) await removeAccount(account.id).catch(() => undefined);
    }
  }, [user, accounts, logout, removeAccount]);

  /** Checks the server answers, then makes it this device's server. False when it doesn't. */
  const switchTo = useCallback(
    async (apiBase: string) => {
      if (!(await probeServer(apiBase))) return false;
      if (currentApiBase() && currentApiBase() !== apiBase) await leave();
      await saveServerChoice({ mode: "server", url: apiBase });
      return true;
    },
    [leave],
  );

  /** Misty as the browser only: signed out, with no server. */
  const browseOnly = useCallback(async () => {
    if (currentApiBase()) await leave();
    await saveServerChoice({ mode: "none" });
  }, [leave]);

  return { switchTo, browseOnly };
}
