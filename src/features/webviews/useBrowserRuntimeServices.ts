import { useEffect, useRef } from "react";
import { useAuth } from "@/features/auth";
import { useBrowserMediaStore } from "@/features/browser/library";
import { listenForPasswordOffers } from "@/features/passwords/offers";
import { startTabArchive } from "@/features/workspace/tabArchive";
import { startAutoPictureInPicture } from "./autoPictureInPicture";
import { startBrowserTabSleep } from "./browserTabSleep";

/** Background services that run for as long as the browser bridge is mounted. */
export function useBrowserRuntimeServices(): void {
  useEffect(() => startAutoPictureInPicture(), []);
  useEffect(() => startBrowserTabSleep(), []);
  useEffect(() => listenForPasswordOffers(), []);
  const { user } = useAuth();
  const archiveAccount = useRef(user?.id ?? "");
  archiveAccount.current = user?.id ?? "";
  useEffect(
    () =>
      startTabArchive({
        accountId: () => archiveAccount.current,
        audible: (viewId) => Boolean(useBrowserMediaStore.getState().audible[viewId]),
      }),
    [],
  );
}
