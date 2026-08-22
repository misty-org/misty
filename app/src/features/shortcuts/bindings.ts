import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { ShortcutBindingPair, ShortcutPlatform, ShortcutScope } from "./registry";

export type ShortcutSlot = "primary" | "alternate";

export interface ParsedShortcut {
  alt: boolean;
  ctrl: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
}

export function detectShortcutPlatform(): ShortcutPlatform {
  if (hasTauriInternals()) {
    try {
      const value = osPlatform();
      if (value === "macos" || value === "windows" || value === "linux") return value;
    } catch {
      // The browser fallback below keeps tests and web previews usable.
    }
  }
  if (/mac|iphone|ipad|ipod/i.test(navigator.platform)) return "macos";
  if (/win/i.test(navigator.platform)) return "windows";
  return "linux";
}

export function parseShortcut(shortcut: string | null | undefined): ParsedShortcut | null {
  if (!shortcut?.trim()) return null;
  const parsed: ParsedShortcut = { alt: false, ctrl: false, key: "", meta: false, shift: false };
  for (const rawToken of shortcut.split("+")) {
    const token = rawToken.trim();
    if (!token) continue;
    const modifier = modifierToken(token);
    if (modifier) parsed[modifier] = true;
    else if (parsed.key) return null;
    else parsed.key = normalizeKey(token);
  }
  return parsed.key ? parsed : null;
}

export function normalizeShortcut(shortcut: string | null | undefined): string | null {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return null;
  return [
    parsed.ctrl ? "Ctrl" : "",
    parsed.alt ? "Alt" : "",
    parsed.shift ? "Shift" : "",
    parsed.meta ? "Cmd" : "",
    canonicalKey(parsed.key),
  ]
    .filter(Boolean)
    .join("+");
}

export function shortcutMatchesEvent(
  shortcut: string | null | undefined,
  event: KeyboardEvent,
): boolean {
  const parsed = parseShortcut(shortcut);
  const shiftMatches =
    event.shiftKey === parsed?.shift || (parsed?.key === "plus" && !parsed.shift && event.shiftKey);
  return Boolean(
    parsed &&
    event.altKey === parsed.alt &&
    event.ctrlKey === parsed.ctrl &&
    event.metaKey === parsed.meta &&
    shiftMatches &&
    eventKey(event) === parsed.key,
  );
}

export function shortcutFromEvent(event: KeyboardEvent): string | null {
  const key = eventKey(event);
  if (!key || ["alt", "control", "meta", "shift"].includes(key)) return null;
  return normalizeShortcut(
    [
      event.ctrlKey ? "Ctrl" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey && key !== "plus" ? "Shift" : "",
      event.metaKey ? "Cmd" : "",
      canonicalKey(key),
    ]
      .filter(Boolean)
      .join("+"),
  );
}

export function formatShortcut(
  shortcut: string | null | undefined,
  platform: ShortcutPlatform,
): string[] {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return [];
  if (platform === "macos") {
    return [
      parsed.ctrl ? "⌃" : "",
      parsed.alt ? "⌥" : "",
      parsed.shift ? "⇧" : "",
      parsed.meta ? "⌘" : "",
      macKeycap(parsed.key),
    ].filter(Boolean);
  }
  return [
    parsed.ctrl ? "Ctrl" : "",
    parsed.alt ? "Alt" : "",
    parsed.shift ? "Shift" : "",
    parsed.meta ? "Meta" : "",
    namedKeycap(parsed.key),
  ].filter(Boolean);
}

export function formatShortcutLabel(
  shortcut: string | null | undefined,
  platform: ShortcutPlatform,
): string {
  return formatShortcut(shortcut, platform).join(platform === "macos" ? "" : "+");
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox'], .cm-editor, .xterm",
    ),
  );
}

export function isReservedShortcut(shortcut: string, platform: ShortcutPlatform): string | null {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return "Press a key together with any required modifiers.";
  if (
    platform === "macos" &&
    ["Cmd+Q", "Cmd+H", "Cmd+M", "Cmd+Space", "Cmd+Tab", "Ctrl+Cmd+Q", "Alt+Cmd+Escape"].includes(
      normalized,
    )
  )
    return `${formatShortcut(normalized, platform).join("")} is reserved by macOS.`;
  if (platform !== "macos" && parseShortcut(normalized)?.meta)
    return "The Command/Windows key is reserved for operating-system shortcuts on this platform.";
  if (
    platform !== "macos" &&
    ["Alt+F4", "Alt+Tab", "Ctrl+Escape", "Ctrl+Shift+Escape", "Ctrl+Alt+Delete"].includes(
      normalized,
    )
  )
    return `${formatShortcut(normalized, platform).join("+")} is reserved by the operating system.`;
  return null;
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

function modifierToken(token: string): "alt" | "ctrl" | "meta" | "shift" | null {
  switch (token.toLowerCase()) {
    case "alt":
    case "option":
      return "alt";
    case "cmd":
    case "command":
    case "meta":
    case "super":
      return "meta";
    case "control":
    case "ctrl":
      return "ctrl";
    case "shift":
      return "shift";
    case "cmdorctrl":
    case "primary":
      return detectShortcutPlatform() === "macos" ? "meta" : "ctrl";
    default:
      return null;
  }
}

function normalizeKey(token: string): string {
  const lower = token.toLowerCase();
  if (/^[a-z0-9]$/.test(lower) || /^f\d{1,2}$/.test(lower)) return lower;
  const aliases: Record<string, string> = {
    "`": "grave",
    backquote: "grave",
    ",": "comma",
    ".": "period",
    "-": "minus",
    "=": "plus",
    "+": "plus",
    "[": "leftbracket",
    "]": "rightbracket",
    "\\": "backslash",
    left: "arrowleft",
    right: "arrowright",
    up: "arrowup",
    down: "arrowdown",
    del: "delete",
    esc: "escape",
    return: "enter",
    spacebar: "space",
  };
  return aliases[lower] ?? lower.replace(/ /g, "");
}

function eventKey(event: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^F\d{1,2}$/.test(event.code)) return event.code.toLowerCase();
  const codes: Record<string, string> = {
    Backquote: "grave",
    Backslash: "backslash",
    BracketLeft: "leftbracket",
    BracketRight: "rightbracket",
    Comma: "comma",
    Period: "period",
    Equal: "plus",
    Minus: "minus",
    ArrowLeft: "arrowleft",
    ArrowRight: "arrowright",
    ArrowUp: "arrowup",
    ArrowDown: "arrowdown",
    PageUp: "pageup",
    PageDown: "pagedown",
  };
  return codes[event.code] ?? normalizeKey(event.key);
}

function canonicalKey(key: string): string {
  const names: Record<string, string> = {
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
    backslash: "Backslash",
    comma: "Comma",
    period: "Period",
    grave: "Grave",
    leftbracket: "LeftBracket",
    rightbracket: "RightBracket",
    pageup: "PageUp",
    pagedown: "PageDown",
    plus: "Plus",
    minus: "Minus",
  };
  return (
    names[key] ?? (key.length === 1 ? key.toUpperCase() : key[0]?.toUpperCase() + key.slice(1))
  );
}

function macKeycap(key: string): string {
  const names: Record<string, string> = {
    arrowleft: "←",
    arrowright: "→",
    arrowup: "↑",
    arrowdown: "↓",
    backspace: "⌫",
    delete: "⌦",
    enter: "↩",
    escape: "Esc",
    grave: "`",
    comma: ",",
    period: ".",
    leftbracket: "[",
    rightbracket: "]",
    backslash: "\\",
    pageup: "Page Up",
    pagedown: "Page Down",
    plus: "+",
    minus: "−",
    tab: "Tab",
    space: "Space",
  };
  return names[key] ?? key.toUpperCase();
}

function namedKeycap(key: string): string {
  const names: Record<string, string> = {
    arrowleft: "Left",
    arrowright: "Right",
    arrowup: "Up",
    arrowdown: "Down",
    grave: "`",
    comma: ",",
    period: ".",
    leftbracket: "[",
    rightbracket: "]",
    backslash: "\\",
    pageup: "Page Up",
    pagedown: "Page Down",
    plus: "+",
    minus: "−",
  };
  return names[key] ?? (key.length === 1 ? key.toUpperCase() : canonicalKey(key));
}
