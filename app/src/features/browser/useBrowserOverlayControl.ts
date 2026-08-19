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
      // A native child WebView starts above the renderer so it can receive
      // input. Do not mount the popup portal until macOS has moved that child
      // below Misty's renderer, or the page can cover the popup for one frame.
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
