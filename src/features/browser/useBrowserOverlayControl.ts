import { useCallback, useEffect, useRef, useState } from "react";
import { browserOverlayReady, setBrowserWebviewsSuspended } from "./browserRuntime";

export function useBrowserOverlayControl(reason: string) {
  const [open, setOpen] = useState(false);
  const requestedOpen = useRef(false);
  const generation = useRef(0);

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      requestedOpen.current = nextOpen;
      const requestGeneration = ++generation.current;
      if (!nextOpen) {
        setOpen(false);
        setBrowserWebviewsSuspended(false, reason);
        return;
      }

      setBrowserWebviewsSuspended(true, reason);
      // External pages are the top sibling during normal browsing. Mount the
      // popup only after native ownership has moved back to Misty's renderer.
      void browserOverlayReady().then(() => {
        if (requestedOpen.current && generation.current === requestGeneration) {
          setOpen(true);
        }
      });
    },
    [reason],
  );

  useEffect(
    () => () => {
      requestedOpen.current = false;
      generation.current += 1;
      setBrowserWebviewsSuspended(false, reason);
    },
    [reason],
  );

  return { open, onOpenChange };
}
