import { useEffect, useState, type RefObject } from "react";

/**
 * The background of the browser page that runs along the workspace edge facing the
 * Misty panel, so the panel can read as the page extended. Only dark pages qualify:
 * the panel's text and controls are light.
 */
export function usePageBackgroundBeside(
  workspace: RefObject<HTMLElement | null>,
  side: "left" | "right",
  enabled: boolean,
): string | undefined {
  const [color, setColor] = useState<string>();
  useEffect(() => {
    const root = workspace.current;
    if (!enabled || !root) {
      setColor(undefined);
      return;
    }
    let frame = 0;
    let lastHost: HTMLElement | undefined;
    const measure = () => {
      frame = 0;
      const edge = root.getBoundingClientRect();
      const host = Array.from(root.querySelectorAll<HTMLElement>("[data-browser-page-host]")).find(
        (candidate) => {
          const rect = candidate.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return false;
          const gap = side === "right" ? edge.right - rect.right : rect.left - edge.left;
          return Math.abs(gap) <= 2;
        },
      );
      const next = host?.dataset.mistyBrowserBackground;
      // A navigation clears the page color until the new page reports one;
      // keep the current color meanwhile instead of flashing the default.
      if (host && !next && host === lastHost) return;
      lastHost = host;
      setColor(next && isDark(next) ? next : undefined);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    // Page colors arrive as host attributes; tab and pane switches change classes.
    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-misty-browser-background", "class", "hidden"],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("misty:workspace-geometry-changed", schedule);
    measure();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("misty:workspace-geometry-changed", schedule);
    };
  }, [workspace, side, enabled]);
  return color;
}

function isDark(hex: string): boolean {
  const value = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!value) return false;
  const [r, g, b] = value.slice(1).map((channel) => parseInt(channel, 16) / 255) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.25;
}
