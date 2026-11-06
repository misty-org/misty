// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import autofillScript from "../../../src-tauri/src/infra/browser/scripts/autofill.js?raw";
import fieldsScript from "../../../src-tauri/src/infra/browser/scripts/autofill_fields.js?raw";
import passwordsScript from "../../../src-tauri/src/infra/browser/scripts/passwords.js?raw";

// The page scripts as they ship. jsdom marks dispatched events untrusted, which the scripts rightly
// ignore, so that one check is lifted here and nothing else changes.
type Page = {
  __MISTY_AUTOFILL__: { offer(kind: string): void };
};
const page = () => window as unknown as Page;

const popups = () => document.documentElement.querySelectorAll(":scope > [popover]").length;

/** What a click does: the old field loses focus, then the new one gets it. */
function moveFocus(from: HTMLElement | null, to: HTMLElement) {
  from?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  to.focus();
  to.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
}

function input(name: string) {
  return document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
}

beforeAll(() => {
  // jsdom lays nothing out, so every element is on the page.
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 10, right: 110, top: 10, bottom: 30, width: 100, height: 20, x: 10, y: 10 }) as DOMRect;
  const lift = (script: string) => script.replace(/event\.isTrusted/g, "true");
  new Function(
    "sendHostNavigation",
    "encode",
    "shortcutToken",
    `${lift(passwordsScript)}\n${fieldsScript}\n${lift(autofillScript)}`,
  )(() => undefined, encodeURIComponent, "token");
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  // Popups sit beside the body, so resetting it wouldn't clear one a test left open.
  document.documentElement.querySelectorAll(":scope > [popover]").forEach((popup) => popup.remove());
  document.body.innerHTML = "";
});

describe("a fill popup stays open", () => {
  it("when an address field's answer arrives right after moving from another field", () => {
    document.body.innerHTML = `<form>
      <input name="name" autocomplete="name"><input name="street" autocomplete="street-address">
      <input name="zip" autocomplete="postal-code"></form>`;
    moveFocus(null, input("name"));
    moveFocus(input("name"), input("street"));
    // Misty answers before the first field's 150ms close timer has run.
    vi.advanceTimersByTime(30);
    page().__MISTY_AUTOFILL__.offer("address");
    expect(popups()).toBe(1);
    vi.advanceTimersByTime(500);
    expect(popups()).toBe(1);
  });
});

describe("a fill popup still closes", () => {
  it("when focus really leaves its field", () => {
    document.body.innerHTML = `<form>
      <input name="street" autocomplete="street-address"><input name="zip" autocomplete="postal-code">
      <input name="city" autocomplete="address-level2"></form>
      <input name="other"><input name="other2" type="password">`;
    moveFocus(null, input("street"));
    page().__MISTY_AUTOFILL__.offer("address");
    expect(popups()).toBe(1);
    moveFocus(input("street"), input("other"));
    vi.advanceTimersByTime(200);
    expect(popups()).toBe(0);
  });
});
