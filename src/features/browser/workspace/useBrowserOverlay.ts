import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export const BrowserOverlayAvailability = createContext(true);

export function useBrowserOverlay(
  reason: string,
  setOverlay: (reason: string, active: boolean) => Promise<void>,
) {
  const available = useContext(BrowserOverlayAvailability);
  const [open, setOpen] = useState(false);
  const requestedOpen = useRef(false);
  const generation = useRef(0);

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      nextOpen = nextOpen && available;
      requestedOpen.current = nextOpen;
      const requestGeneration = ++generation.current;
      if (!nextOpen) {
        setOpen(false);
        void setOverlay(reason, false).catch(() => undefined);
        return;
      }

      // External pages are the top sibling during normal browsing. Mount the
      // popup only after native ownership has moved back to Misty's renderer.
      void setOverlay(reason, true)
        .then(() => {
          if (requestedOpen.current && generation.current === requestGeneration) {
            setOpen(true);
          }
        })
        .catch(() => {
          if (generation.current === requestGeneration) {
            setOpen(false);
            void setOverlay(reason, false).catch(() => undefined);
          }
        });
    },
    [reason, setOverlay, available],
  );
  useEffect(() => {
    if (!available) onOpenChange(false);
  }, [available, onOpenChange]);

  useEffect(
    () => () => {
      requestedOpen.current = false;
      generation.current += 1;
      void setOverlay(reason, false).catch(() => undefined);
    },
    [reason, setOverlay],
  );

  return { open, onOpenChange };
}
