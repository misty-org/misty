import { cx } from "class-variance-authority";
import { extendTailwindMerge } from "tailwind-merge";

// Named stacking layers from styles.css; they replace each other like z-* utilities.
const layers = [
  "agent-surface",
  "chrome",
  "workspace-overlay",
  "notification",
  "notification-raised",
  "dialog-backdrop",
  "dialog",
  "blocking-backdrop",
  "blocking",
  "blocking-popup",
  "menu",
  "menu-raised",
  "popover",
  "tooltip",
];

// The type scale's added steps (theme.css) are font sizes, not text colors. Without this,
// `cn("text-ui", "text-cream")` would drop the size as a conflicting color.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: { z: [{ layer: layers }] },
    theme: { text: ["3xs", "2xs", "ui", "md"] },
  },
});

export function cn(...inputs: Parameters<typeof cx>) {
  return twMerge(cx(inputs));
}
