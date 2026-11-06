import { useEffect, useRef } from "react";
import { useAuth } from "@/features/auth";
import { useBrowserMediaStore } from "@/features/browser/library";
import { listenForPasswordMenus } from "@/features/passwords/fillMenu";
import { listenForPasswordOffers } from "@/features/passwords/offers";
import { accountScopeFor } from "@/features/workspace/accountScope";
import { startTabArchive } from "@/features/workspace/tabArchive";

/** Background services that run for as long as the browser bridge is mounted. */
export function useBrowserRuntimeServices(): void {
  useEffect(() => listenForPasswordOffers(), []);
  useEffect(() => listenForPasswordMenus(), []);
  const { user } = useAuth();
  // Archived tabs belong to the profile: the account, or the local one signed out.
  const archiveAccount = useRef(accountScopeFor(user?.id));
  archiveAccount.current = accountScopeFor(user?.id);
  useEffect(
    () =>
      startTabArchive({
        accountId: () => archiveAccount.current,
        audible: (viewId) => Boolean(useBrowserMediaStore.getState().audible[viewId]),
      }),
    [],
  );
}
