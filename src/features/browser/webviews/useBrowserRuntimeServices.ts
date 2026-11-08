import { useEffect, useRef } from "react";
import { useAuth } from "@/features/account";
import { useBrowserMediaStore } from "../library";
import { listenForAutofillChips } from "../autofill/chip";
import { listenForAutofillOffers } from "../autofill/offers";
import { listenForPasswordMenus } from "../passwords/fillMenu";
import { listenForPasswordOffers } from "../passwords/offers";
import { accountScopeFor } from "@/features/app-windows";
import { startTabArchive } from "@/features/app-windows";

/** Background services that run for as long as the browser bridge is mounted. */
export function useBrowserRuntimeServices(): void {
  useEffect(() => listenForPasswordOffers(), []);
  useEffect(() => listenForPasswordMenus(), []);
  useEffect(() => listenForAutofillOffers(), []);
  useEffect(() => listenForAutofillChips(), []);
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
