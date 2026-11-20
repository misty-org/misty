import { desktopOs } from "@/shared/platform/desktopOs";
import { shortcutMatchesEvent } from "@misty/ui";
import type { ShortcutBindingPair, ShortcutPlatform, ShortcutScope } from "./registry";

// Parsing, matching and drawing shortcuts live in @misty/ui, beside ShortcutField and Kbd.
export {
  formatShortcut,
  formatShortcutLabel,
  isEditableShortcutTarget,
  isReservedShortcut,
  normalizeShortcut,
  parseShortcut,
  shortcutFromEvent,
  shortcutMatchesEvent,
  type ShortcutSlot,
} from "@misty/ui";

/** The operating system, from the native side when Misty runs as the app. */
export function detectShortcutPlatform(): ShortcutPlatform {
  return desktopOs();
}

export function scopesOverlap(left: ShortcutScope, right: ShortcutScope): boolean {
  if (left === right) return true;
  if (left === "global" || right === "global") return true;
  if (left === "workspace" || right === "workspace") return true;
  return false;
}

export function bindingPairMatchesEvent(pair: ShortcutBindingPair, event: KeyboardEvent): boolean {
  return shortcutMatchesEvent(pair.primary, event) || shortcutMatchesEvent(pair.alternate, event);
}
