import { clsx, type ClassValue } from "clsx";
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

const twMerge = extendTailwindMerge({
  extend: { classGroups: { z: [{ layer: layers }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
