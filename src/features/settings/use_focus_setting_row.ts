import { useEffect, useRef } from "react";

export function useFocusSettingRow(focus: { label: string; request: number }) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = content.current;
    if (!focus.label || !root) return;
    let clearFlash: ReturnType<typeof setTimeout> | undefined;
    const find = (selector: string, attribute: string) =>
      Array.from(root.querySelectorAll<HTMLElement>(selector)).find(
        (element) => element.getAttribute(attribute) === focus.label,
      );
    const land = () => {
      const element =
        find("[data-setting-label]", "data-setting-label") ??
        find("[aria-label]", "aria-label") ??
        find("[data-settings-target]", "data-settings-target");
      if (!element || element.getClientRects().length === 0) return false;
      const wholeBlock = focus.label.startsWith("page:");
      const scroller = element.closest<HTMLElement>("[data-settings-scroller]");
      if (scroller) {
        const offset = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTop = wholeBlock
          ? scroller.scrollTop + offset - 18
          : scroller.scrollTop + offset - (scroller.clientHeight - element.offsetHeight) / 2;
      }
      const target = wholeBlock
        ? element
        : (element.querySelector<HTMLElement>(
            "[data-setting-control] input:not(:disabled),[data-setting-control] button:not(:disabled),[data-setting-control] select:not(:disabled)",
          ) ?? element);
      target.focus({ preventScroll: true });
      if (wholeBlock) return true;
      element.dataset.flash = "true";
      clearFlash = setTimeout(() => delete element.dataset.flash, 900);
      return true;
    };
    if (land()) return () => clearTimeout(clearFlash);
    const observer = new MutationObserver(() => {
      if (land()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clearTimeout(clearFlash);
    };
  }, [focus]);
  return content;
}
