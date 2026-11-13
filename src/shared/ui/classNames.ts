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

// The type roles in theme.css. They are font sizes, not text colors: without this,
// `cn("text-control", "text-cream")` would drop the size as a conflicting color, and
// `cn("text-meta", "text-control")` would keep both.
const typeRoles = [
  "micro",
  "caption",
  "meta",
  "control",
  "body",
  "page",
  "title",
  "display",
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: { z: [{ layer: layers }] },
    theme: { text: [...typeRoles] },
  },
});

export function cn(...inputs: Parameters<typeof cx>) {
  return twMerge(cx(inputs));
}
