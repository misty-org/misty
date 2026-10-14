import type { ExtensionAction } from "./types";

const storageKey = "misty.extensionIcons";
// A data URL for a toolbar icon is small; anything larger is not worth keeping.
const maxIconLength = 40_000;

function read(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    return value && typeof value === "object" ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * A disabled extension has no live toolbar action, so its icon would vanish.
 * Remember each one while it reports an icon, and show that one when it is off.
 */
export function rememberExtensionIcons(actions: ExtensionAction[]): void {
  const known = read();
  let changed = false;
  for (const action of actions) {
    if (!action.icon || action.icon.length > maxIconLength || known[action.id] === action.icon)
      continue;
    known[action.id] = action.icon;
    changed = true;
  }
  if (!changed) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(known));
  } catch {
    // Storage can be full or blocked; the row falls back to the generic icon.
  }
}

export function rememberedExtensionIcon(id: string): string | undefined {
  return read()[id];
}
