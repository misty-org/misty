import { useEffect, useRef } from "react";
import { useAuth } from "@/features/auth";
import { useBrowserMediaStore } from "@/features/browser/library";
import { listenForPasswordOffers } from "@/features/passwords/offers";
import { profileIdFor } from "@/features/workspace/profileId";
import { startTabArchive } from "@/features/workspace/tabArchive";

/** Background services that run for as long as the browser bridge is mounted. */
export function useBrowserRuntimeServices(): void {
  useEffect(() => listenForPasswordOffers(), []);
  const { user } = useAuth();
  // Archived tabs belong to the profile: the account, or the local one signed out.
  const archiveAccount = useRef(profileIdFor(user?.id));
  archiveAccount.current = profileIdFor(user?.id);
  useEffect(
    () =>
      startTabArchive({
        accountId: () => archiveAccount.current,
        audible: (viewId) => Boolean(useBrowserMediaStore.getState().audible[viewId]),
      }),
    [],
  );
}
