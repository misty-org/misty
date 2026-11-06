// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import autofillScript from "../../../src-tauri/src/infra/browser/scripts/autofill.js?raw";
import fieldsScript from "../../../src-tauri/src/infra/browser/scripts/autofill_fields.js?raw";
import passwordsScript from "../../../src-tauri/src/infra/browser/scripts/passwords.js?raw";

// The page scripts as they ship. jsdom marks dispatched events untrusted, which the scripts rightly
// ignore, so that one check is lifted here and nothing else changes.
const sent: string[] = [];
const actions = () => sent.map((url) => url.slice(0, url.indexOf("?")));

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
    ({
      left: 10,
      right: 110,
      top: 10,
      bottom: 30,
      width: 100,
      height: 20,
      x: 10,
      y: 10,
    }) as DOMRect;
  Element.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
  const lift = (script: string) => script.replace(/event\.isTrusted/g, "true");
  new Function(
    "sendHostNavigation",
    "encode",
    "shortcutToken",
    `${lift(passwordsScript)}\n${fieldsScript}\n${lift(autofillScript)}`,
  )((url: string) => sent.push(url), encodeURIComponent, "token");
});

beforeEach(() => {
  sent.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("Misty's fill surfaces stay open", () => {
  it("when moving between an address form's fields", () => {
    document.body.innerHTML = `<form>
      <input name="name" autocomplete="name"><input name="street" autocomplete="street-address">
      <input name="zip" autocomplete="postal-code"></form>`;
    moveFocus(null, input("name"));
    moveFocus(input("name"), input("street"));
    vi.advanceTimersByTime(500);
    expect(actions()).not.toContain("misty-autofill:hide");
  });

  it("when moving from a username to its password", () => {
    document.body.innerHTML = `<form><input name="user" type="text">
      <input name="pass" type="password"></form>`;
    moveFocus(null, input("user"));
    moveFocus(input("user"), input("pass"));
    vi.advanceTimersByTime(500);
    expect(actions()).not.toContain("misty-passwords:hide");
  });
});

describe("Misty's fill surfaces still close", () => {
  it("when focus really leaves an address form", () => {
    document.body.innerHTML = `<form>
      <input name="street" autocomplete="street-address"><input name="zip" autocomplete="postal-code">
      <input name="city" autocomplete="address-level2"></form><button name="elsewhere"></button>`;
    moveFocus(null, input("street"));
    moveFocus(input("street"), document.querySelector<HTMLElement>('[name="elsewhere"]')!);
    vi.advanceTimersByTime(200);
    expect(actions()).toContain("misty-autofill:hide");
  });

  it("when the password field loses focus", () => {
    document.body.innerHTML = `<form><input name="user" type="text">
      <input name="pass" type="password"></form><button name="elsewhere"></button>`;
    moveFocus(null, input("pass"));
    moveFocus(input("pass"), document.querySelector<HTMLElement>('[name="elsewhere"]')!);
    vi.advanceTimersByTime(200);
    expect(actions()).toContain("misty-passwords:hide");
  });

  it("not at all for a field that never asked", () => {
    document.body.innerHTML = `<input name="search"><button name="elsewhere"></button>`;
    moveFocus(null, input("search"));
    moveFocus(input("search"), document.querySelector<HTMLElement>('[name="elsewhere"]')!);
    vi.advanceTimersByTime(200);
    expect(sent).toEqual([]);
  });
});
