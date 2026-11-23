import { useLayoutEffect, useState, type RefObject } from "react";
import { windowsCaptionSlotId } from "./WindowsTitlebarControls";

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
