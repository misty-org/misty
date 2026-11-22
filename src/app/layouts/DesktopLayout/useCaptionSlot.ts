import { useLayoutEffect, useState, type RefObject } from "react";
import { windowsCaptionSlotId } from "./WindowsTitlebarControls";

/**
 * The tab row's slot for the Windows caption buttons, while it is on screen. Without one (sign-in,
 * tabs beside the page) the buttons sit over the window's top-right corner instead.
 */
export function useCaptionSlot(shellRef: RefObject<HTMLElement | null>, wanted: boolean) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!wanted || !shell) {
      setSlot(null);
      return;
    }
    const find = () => {
      const next = document.getElementById(windowsCaptionSlotId);
      setSlot((current) => (current === next ? current : next));
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(shell, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [shellRef, wanted]);
  return slot;
}
