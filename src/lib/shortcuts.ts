import type { ShortcutMap } from "@/models/types/lib/shortcuts";
export type { ShortcutMap } from "@/models/types/lib/shortcuts";
import type { ParsedShortcut } from "@/models/interfaces/lib/shortcuts";
export type { ParsedShortcut } from "@/models/interfaces/lib/shortcuts";
import type { ShortcutBinding } from "@/models/interfaces/services/misty-api";

export function shortcutMapFromBindings(
  bindings: ShortcutBinding[],
  fallback: ShortcutMap = {},
): ShortcutMap {
  const shortcuts: ShortcutMap = { ...fallback };
  for (const binding of bindings) {
    if (!binding.commandId || !binding.shortcut) continue;
    shortcuts[binding.commandId] = binding.shortcut;
  }
  return shortcuts;
}

export function shortcutMatchesEvent(shortcut: string | undefined, event: KeyboardEvent): boolean {
  if (!shortcut || event.repeat) return false;
  const parsed = parseShortcut(shortcut);
  if (!parsed) return false;
  return (
    event.altKey === parsed.alt &&
    event.ctrlKey === parsed.ctrl &&
    event.metaKey === parsed.meta &&
    event.shiftKey === parsed.shift &&
    normalizedEventKey(event) === parsed.key
  );
}

function parseShortcut(shortcut: string): ParsedShortcut | null {
  const parsed: ParsedShortcut = {
    alt: false,
    ctrl: false,
    key: "",
    meta: false,
    shift: false,
  };

  for (const rawToken of shortcut.split("+")) {
    const token = rawToken.trim();
    if (!token) continue;
    const modifier = normalizedModifierToken(token);
    if (modifier) {
      parsed[modifier] = true;
      continue;
    }
    parsed.key = normalizedShortcutKey(token);
  }

  return parsed.key ? parsed : null;
}

function normalizedModifierToken(token: string): keyof Omit<ParsedShortcut, "key"> | null {
  switch (token.toLowerCase()) {
    case "alt":
    case "option":
      return "alt";
    case "cmd":
    case "command":
    case "meta":
    case "super":
      return "meta";
    case "cmdorctrl":
    case "primary":
      return isMacLikePlatform() ? "meta" : "ctrl";
    case "control":
    case "ctrl":
      return "ctrl";
    case "shift":
      return "shift";
    default:
      return null;
  }
}

function normalizedShortcutKey(token: string): string {
  const lower = token.toLowerCase();
  if (/^[a-z]$/.test(lower) || /^[0-9]$/.test(lower)) return lower;
  if (/^f\d{1,2}$/.test(lower)) return lower;
  switch (lower) {
    case "\\":
    case "backslash":
      return "backslash";
    case "`":
    case "grave":
    case "backquote":
      return "grave";
    case ",":
    case "comma":
      return "comma";
    case "del":
    case "delete":
      return "delete";
    case "esc":
    case "escape":
      return "escape";
    case "enter":
    case "return":
      return "enter";
    case "space":
      return "space";
    case "up":
    case "arrowup":
      return "arrowup";
    case "down":
    case "arrowdown":
      return "arrowdown";
    case "left":
    case "arrowleft":
      return "arrowleft";
    case "right":
    case "arrowright":
      return "arrowright";
    case "backspace":
      return "backspace";
    default:
      return lower;
  }
}

function normalizedEventKey(event: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^F\d{1,2}$/.test(event.code)) return event.code.toLowerCase();
  switch (event.code) {
    case "Backquote":
      return "grave";
    case "Backslash":
      return "backslash";
    case "Comma":
      return "comma";
    default:
      return normalizedShortcutKey(event.key);
  }
}

function isMacLikePlatform(): boolean {
  return /mac|iphone|ipad|ipod/i.test(navigator.platform);
}
