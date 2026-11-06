// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pageScript from "../../../src-tauri/src/infra/browser/scripts/autofill.js?raw";
import fieldsScript from "../../../src-tauri/src/infra/browser/scripts/autofill_fields.js?raw";

// The page script as it ships, in jsdom. jsdom marks dispatched events untrusted, which the script
// rightly ignores, so that one check is lifted here and nothing else changes.
type Autofill = {
  offer(kind: string): void;
  fill(kind: string, values: Record<string, unknown>): void;
};
const autofill = () => (window as unknown as { __MISTY_AUTOFILL__: Autofill }).__MISTY_AUTOFILL__;

const sent: string[] = [];
const shadows: ShadowRoot[] = [];

function message(action: string): URLSearchParams | undefined {
  const found = sent.filter((url) => url.startsWith(`misty-autofill:${action}?`)).pop();
  return found ? new URLSearchParams(found.slice(found.indexOf("?") + 1)) : undefined;
}

function form(html: string): HTMLFormElement {
  document.body.innerHTML = `<form>${html}</form>`;
  return document.querySelector("form")!;
}

function input(name: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
}

function focus(element: HTMLElement) {
  element.focus();
  element.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
}

const ADDRESS = `
  <input name="name" autocomplete="name">
  <input name="street" autocomplete="street-address">
  <input name="city" autocomplete="address-level2">
  <input name="zip" autocomplete="postal-code">`;

const CARD = `
  <input name="number" autocomplete="cc-number">
  <input name="exp" autocomplete="cc-exp" placeholder="MM/YY">
  <input name="cvc" autocomplete="cc-csc">`;

const SAVED_ADDRESS = {
  name: "Ada Lovelace",
  street: "1 Main St",
  city: "Springfield",
  postalCode: "12345",
  phone: "555 0100",
  email: "ada@example.com",
};

beforeAll(() => {
  // jsdom lays nothing out, so every element is on the page unless a test says otherwise.
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const offPage = this.hasAttribute("data-off-page");
    const tiny = this.hasAttribute("data-tiny");
    return {
      left: offPage ? -500 : 10,
      right: offPage ? -400 : 110,
      top: 10,
      bottom: 30,
      width: tiny ? 1 : 100,
      height: tiny ? 1 : 20,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    };
  };
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    const root = attach.call(this, init);
    shadows.push(root);
    return root;
  };
  new Function(
    "sendHostNavigation",
    "encode",
    "shortcutToken",
    `${fieldsScript}\n${pageScript.replace(/event\.isTrusted/g, "true")}`,
  )((url: string) => sent.push(url), encodeURIComponent, "token");
});

beforeEach(() => {
  sent.length = 0;
  shadows.length = 0;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("offering", () => {
  it("tells Misty only the kind of form, from a real address form", () => {
    form(ADDRESS);
    focus(input("street"));
    expect(message("focus")?.get("kind")).toBe("address");
  });

  it("stays quiet on a newsletter box and a contact form", () => {
    form(`<input name="email" autocomplete="email">`);
    focus(input("email"));
    form(`<input name="name" autocomplete="name"><input name="email" autocomplete="email">`);
    focus(input("name"));
    expect(message("focus")).toBeUndefined();
  });

  it("stays quiet on a lone expiry or security code field", () => {
    form(`<input name="exp" autocomplete="cc-exp"><input name="cvc" autocomplete="cc-csc">`);
    focus(input("exp"));
    focus(input("cvc"));
    expect(message("focus")).toBeUndefined();
  });

  it("draws a chip holding no saved details, and asks only when clicked", () => {
    form(ADDRESS);
    focus(input("street"));
    autofill().offer("address");
    expect(shadows).toHaveLength(1);
    const chip = shadows[0]!.querySelector("button")!;
    expect(chip.textContent).toBe("Fill address");
    expect(message("choose")).toBeUndefined();
  });

  it("ignores a click landing just as the chip appears", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    form(ADDRESS);
    focus(input("street"));
    autofill().offer("address");
    const chip = shadows[0]!.querySelector("button")!;
    now.mockReturnValue(1100);
    chip.click();
    expect(message("choose")).toBeUndefined();
    now.mockReturnValue(1400);
    chip.click();
    expect(message("choose")?.get("kind")).toBe("address");
    now.mockRestore();
  });

  it("sends the field's position when asking, and nothing about the person", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    form(ADDRESS);
    focus(input("street"));
    autofill().offer("address");
    now.mockReturnValue(2000);
    shadows[0]!.querySelector("button")!.click();
    expect([...message("choose")!.keys()].sort()).toEqual(["kind", "token", "x", "y"]);
    now.mockRestore();
  });

  it("offers nothing for another kind or a field that lost focus", () => {
    form(ADDRESS);
    focus(input("street"));
    autofill().offer("card");
    expect(shadows).toHaveLength(0);
    input("street").blur();
    autofill().offer("address");
    expect(shadows).toHaveLength(0);
  });
});

describe("filling", () => {
  it("fills the form's visible address fields", () => {
    form(ADDRESS);
    focus(input("street"));
    autofill().fill("address", SAVED_ADDRESS);
    expect(input("name").value).toBe("Ada Lovelace");
    expect(input("street").value).toBe("1 Main St");
    expect(input("city").value).toBe("Springfield");
    expect(input("zip").value).toBe("12345");
  });

  it.each([
    ["hidden type", `<input name="trap" type="hidden" autocomplete="email">`],
    ["display none", `<input name="trap" style="display:none" autocomplete="email">`],
    ["visibility hidden", `<input name="trap" style="visibility:hidden" autocomplete="email">`],
    ["transparent", `<input name="trap" style="opacity:0" autocomplete="email">`],
    ["transparent parent", `<div style="opacity:0"><input name="trap" autocomplete="email"></div>`],
    ["off the page", `<input name="trap" data-off-page autocomplete="email">`],
    ["tiny", `<input name="trap" data-tiny autocomplete="email">`],
    ["disabled", `<input name="trap" disabled autocomplete="email">`],
    ["read only", `<input name="trap" readonly autocomplete="email">`],
  ])("never fills a field that's %s", (_, trap) => {
    form(`${ADDRESS}${trap}`);
    focus(input("street"));
    autofill().fill("address", SAVED_ADDRESS);
    expect(input("street").value).toBe("1 Main St");
    expect(input("trap").value).toBe("");
  });

  it("leaves what the person typed, except in the field they chose", () => {
    form(ADDRESS);
    input("name").value = "Grace Hopper";
    input("street").value = "typed";
    focus(input("street"));
    autofill().fill("address", SAVED_ADDRESS);
    expect(input("name").value).toBe("Grace Hopper");
    expect(input("street").value).toBe("1 Main St");
  });

  it("fills a card and leaves the security code for the person", () => {
    form(CARD);
    focus(input("number"));
    autofill().fill("card", { number: "4242424242424242", holder: "", expMonth: 3, expYear: 2031 });
    expect(input("number").value).toBe("4242424242424242");
    expect(input("exp").value).toBe("03/31");
    expect(input("cvc").value).toBe("");
  });

  it("doesn't put an address into a card's fields or a card into an address's", () => {
    form(`${ADDRESS}${CARD}`);
    focus(input("street"));
    autofill().fill("address", SAVED_ADDRESS);
    expect(input("number").value).toBe("");
    autofill().fill("card", { number: "4242424242424242", expMonth: 3, expYear: 2031 });
    expect(input("number").value).toBe("");
  });

  it("chooses the matching option in a dropdown", () => {
    form(`${ADDRESS}<select name="state" autocomplete="address-level1">
      <option value="">Select</option><option value="CA">California</option>
      <option value="NY">New York</option></select>`);
    focus(input("street"));
    autofill().fill("address", { ...SAVED_ADDRESS, region: "New York" });
    expect(document.querySelector<HTMLSelectElement>("select")!.value).toBe("NY");
  });

  it("tells the page about each change so its own form code sees it", () => {
    form(ADDRESS);
    const seen = vi.fn();
    input("city").addEventListener("input", seen);
    focus(input("street"));
    autofill().fill("address", SAVED_ADDRESS);
    expect(seen).toHaveBeenCalledOnce();
  });
});

describe("capturing", () => {
  const submit = (element: HTMLFormElement) =>
    element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  it("reports a submitted address", () => {
    const element = form(ADDRESS);
    input("name").value = "Ada Lovelace";
    input("street").value = "1 Main St";
    input("city").value = "Springfield";
    input("zip").value = "12345";
    submit(element);
    const data = JSON.parse(message("capture")!.get("data")!);
    expect(data.address).toMatchObject({ street: "1 Main St", postalCode: "12345" });
  });

  it("never reads a security code or a password", () => {
    const element = form(`${CARD}<input name="pw" type="password">`);
    input("number").value = "4242424242424242";
    input("exp").value = "12/31";
    input("cvc").value = "987";
    input("pw").value = "hunter2";
    submit(element);
    const raw = message("capture")!.get("data")!;
    expect(JSON.parse(raw).card).toMatchObject({ number: "4242424242424242", expMonth: 12 });
    expect(raw).not.toContain("987");
    expect(raw).not.toContain("hunter2");
  });

  it("doesn't collect hidden fields", () => {
    const element = form(`${ADDRESS}<input name="trap" style="display:none" autocomplete="tel">`);
    input("street").value = "1 Main St";
    input("city").value = "Springfield";
    input("trap").value = "555 0199";
    submit(element);
    expect(message("capture")!.get("data")!).not.toContain("555 0199");
  });

  it("says nothing about a form that's neither, or the same form twice", () => {
    const contact = form(`<input name="name" autocomplete="name">`);
    input("name").value = "Ada";
    submit(contact);
    expect(message("capture")).toBeUndefined();
    const element = form(ADDRESS);
    input("street").value = "2 Side St";
    input("city").value = "Shelbyville";
    submit(element);
    submit(element);
    expect(sent.filter((url) => url.startsWith("misty-autofill:capture"))).toHaveLength(1);
  });
});

describe("the token", () => {
  it("is never put where a page could read it", () => {
    expect(Object.keys(window)).not.toContain("shortcutToken");
    expect(JSON.stringify(Object.getOwnPropertyDescriptor(window, "__MISTY_AUTOFILL__"))).not.toContain(
      "token",
    );
  });
});
