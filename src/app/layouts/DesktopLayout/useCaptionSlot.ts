import { useLayoutEffect, useState, type RefObject } from "react";
import { windowsCaptionSlotId } from "./WindowsTitlebarControls";

/** The sidebar header's slot for the Windows caption buttons, once it is on screen. */
export function useCaptionSlot(shellRef: RefObject<HTMLElement | null>, wanted: boolean) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || !wanted) {
      setSlot(null);
      return;
    }
    const find = () => setSlot(document.getElementById(windowsCaptionSlotId));
    find();
    const observer = new MutationObserver(find);
    observer.observe(shell, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [shellRef, wanted]);
  return slot;
}
