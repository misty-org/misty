import { describe, expect, it } from "vitest";
import {
  bindingPairMatchesEvent,
  formatShortcut,
  isReservedShortcut,
  normalizeShortcut,
  parseShortcut,
  scopesOverlap,
  shortcutFromEvent,
  shortcutMatchesEvent,
} from "./bindings";

describe("shortcut bindings", () => {
  it("normalizes aliases and modifier order", () => {
    expect(normalizeShortcut("shift + command + k")).toBe("Shift+Cmd+K");
    expect(normalizeShortcut("Option+Ctrl+Left")).toBe("Ctrl+Alt+ArrowLeft");
    expect(parseShortcut("Ctrl+PageDown")).toMatchObject({ ctrl: true, key: "pagedown" });
  });

  it("matches physical letter keys and either binding slot", () => {
    const event = new KeyboardEvent("keydown", { code: "KeyK", key: "k", ctrlKey: true });
    expect(shortcutMatchesEvent("Ctrl+K", event)).toBe(true);
    expect(bindingPairMatchesEvent({ primary: "Ctrl+P", alternate: "Ctrl+K" }, event)).toBe(true);
  });

  it("treats Shift as implicit when recording and matching Plus", () => {
    const event = new KeyboardEvent("keydown", {
      code: "Equal",
      key: "+",
      metaKey: true,
      shiftKey: true,
    });
    expect(shortcutFromEvent(event)).toBe("Cmd+Plus");
    expect(shortcutMatchesEvent("Cmd+Plus", event)).toBe(true);
  });

  it("matches minus on both the main keyboard and numpad", () => {
    const main = new KeyboardEvent("keydown", {
      code: "Minus",
      key: "-",
      ctrlKey: true,
    });
    const numpad = new KeyboardEvent("keydown", {
      code: "NumpadSubtract",
      key: "Subtract",
      ctrlKey: true,
    });

    expect(shortcutMatchesEvent("Ctrl+Minus", main)).toBe(true);
    expect(shortcutMatchesEvent("Ctrl+Minus", numpad)).toBe(true);
    expect(shortcutFromEvent(numpad)).toBe("Ctrl+Minus");
  });

  it("renders native keycaps", () => {
    expect(formatShortcut("Cmd+Option+Shift+1", "macos")).toEqual(["⌥", "⇧", "⌘", "1"]);
    expect(formatShortcut("Ctrl+Shift+PageDown", "windows")).toEqual([
      "Ctrl",
      "Shift",
      "Page Down",
    ]);
  });

  it("rejects OS-reserved combinations while allowing focused-tool keys", () => {
    expect(isReservedShortcut("Cmd+Q", "macos")).toContain("reserved");
    expect(isReservedShortcut("Cmd+Space", "macos")).toContain("reserved");
    expect(isReservedShortcut("Alt+F4", "windows")).toContain("reserved");
    expect(isReservedShortcut("Cmd+K", "windows")).toContain("Windows key");
    expect(isReservedShortcut("C", "macos")).toBeNull();
  });

  it("recognizes overlapping context hierarchies", () => {
    expect(scopesOverlap("global", "tool:code")).toBe(true);
    expect(scopesOverlap("workspace", "tool:files")).toBe(true);
    expect(scopesOverlap("tool:code", "tool:files")).toBe(false);
  });
});
