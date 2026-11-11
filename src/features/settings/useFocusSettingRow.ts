import { useEffect, useRef } from "react";

/**
 * Scrolls to, focuses and briefly highlights the row (by label) or block (`page:<id>`) a search
 * result or deep link pointed at, once its page has rendered.
 */
export function useFocusSettingRow(focus: { label: string; request: number }) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus.label) return;
    let clearFlash: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      const find = (selector: string, attribute: string) =>
        Array.from(content.current?.querySelectorAll<HTMLElement>(selector) ?? []).find(
          (element) => element.getAttribute(attribute) === focus.label,
        );
      const element =
        find("[data-setting-label]", "data-setting-label") ??
        find("[aria-label]", "aria-label") ??
        find("[data-settings-target]", "data-settings-target");
      if (!element) return;
      const wholeBlock = focus.label.startsWith("page:");
      // Scroll only the page. scrollIntoView also scrolls the clipped frame around it, which
      // slid the whole settings window up and hid its close button.
      const scroller = element.closest<HTMLElement>("[data-settings-scroller]");
      if (scroller && wholeBlock) scroller.scrollTop = 0;
      else if (scroller) {
        const offset = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTop =
          scroller.scrollTop + offset - (scroller.clientHeight - element.offsetHeight) / 2;
      }
      const target = wholeBlock
        ? element
        : (element.querySelector<HTMLElement>(
            "[data-setting-control] input:not(:disabled),[data-setting-control] button:not(:disabled),[data-setting-control] select:not(:disabled)",
          ) ?? element);
      target.focus({ preventScroll: true });
      if (wholeBlock) return;
      element.dataset.settingFlash = "true";
      clearFlash = setTimeout(() => delete element.dataset.settingFlash, 900);
    }, 0);
    return () => {
      clearTimeout(timer);
      clearTimeout(clearFlash);
    };
  }, [focus]);
  return content;
}
