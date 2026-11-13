import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readPickedElement } from "./pickedElement";

type Picker = {
  start(): void;
  cancel(): void;
  selector(element: Element): string;
  describe(element: Element): unknown;
  errors(): string[];
};
const page = window as unknown as { __MISTY_PREVIEW__: Picker; __MISTY_PREVIEW_PICKED__?: string };

// The script the native side runs in the preview page, tested as it ships.
beforeAll(() => {
  const source = readFileSync(
    resolve(process.cwd(), "src-tauri/features/project/preview_picker.js"),
    "utf8",
  );
  new Function(source)();
});

beforeEach(() => {
  document.body.innerHTML = `
    <main id="app">
      <ul class="list">
        <li class="item">One</li>
        <li class="item">Two</li>
        <li class="item css-1x2y3z9 selected">Three</li>
      </ul>
      <button data-testid="save">Save</button>
      <section><p>Alone</p></section>
      <div id="twin"></div><div id="twin"></div>
      <input id="7up" />
    </main>`;
});

const only = (selector: string) => {
  const found = document.querySelectorAll(selector);
  expect(found, selector).toHaveLength(1);
  return found[0];
};

describe("the picker's selector", () => {
  it("uses a unique id", () => {
    expect(page.__MISTY_PREVIEW__.selector(only("#app"))).toBe("#app");
  });

  it("uses a test id when there is one", () => {
    const button = only("button");
    expect(page.__MISTY_PREVIEW__.selector(button)).toBe('[data-testid="save"]');
  });

  it("tells siblings apart by position and skips generated class names", () => {
    const third = document.querySelectorAll("li")[2]!;
    const selector = page.__MISTY_PREVIEW__.selector(third);
    expect(selector).toBe("li.item.selected");
    expect(only(selector)).toBe(third);
    const second = document.querySelectorAll("li")[1]!;
    const secondSelector = page.__MISTY_PREVIEW__.selector(second);
    expect(secondSelector).toContain(":nth-of-type(2)");
    expect(only(secondSelector)).toBe(second);
  });

  it("stops as soon as the path is unique, keeping a bare tag's parent", () => {
    expect(page.__MISTY_PREVIEW__.selector(only("section p"))).toBe("section > p");
  });

  it("does not trust an id the page uses twice", () => {
    const second = document.querySelectorAll("div")[1]!;
    const selector = page.__MISTY_PREVIEW__.selector(second);
    expect(only(selector)).toBe(second);
  });

  it("escapes an id that starts with a digit", () => {
    const input = document.querySelector("input")!;
    expect(only(page.__MISTY_PREVIEW__.selector(input))).toBe(input);
  });
});

describe("the picker's report", () => {
  it("is what the panel reads", () => {
    const report = readPickedElement(page.__MISTY_PREVIEW__.describe(only("button")));
    expect(report).toMatchObject({
      selector: '[data-testid="save"]',
      tag: "button",
      text: "Save",
      html: '<button data-testid="save">Save</button>',
      htmlTruncated: false,
    });
    expect(report?.styles.display).toBeTruthy();
  });

  it("cuts long HTML at about 4 KB", () => {
    const list = only("ul");
    list.innerHTML = "<li>row</li>".repeat(2000);
    const report = readPickedElement(page.__MISTY_PREVIEW__.describe(list));
    expect(report?.htmlTruncated).toBe(true);
    expect(report?.html.length).toBeLessThanOrEqual(4097);
  });

  it("keeps the page's console errors", () => {
    console.error("Could not save", new Error("offline"));
    expect(page.__MISTY_PREVIEW__.errors().pop()).toBe("Could not save offline");
  });
});

describe("a pick", () => {
  it("is cancelled by Escape and leaves nothing behind", () => {
    page.__MISTY_PREVIEW__.start();
    expect(document.querySelector("[data-misty-preview-picker]")).not.toBeNull();
    expect(page.__MISTY_PREVIEW_PICKED__).toBeUndefined();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(page.__MISTY_PREVIEW_PICKED__).toBe("");
    expect(document.querySelector("[data-misty-preview-picker]")).toBeNull();
  });

  it("ignores a click the page made itself", () => {
    page.__MISTY_PREVIEW__.start();
    only("button").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(page.__MISTY_PREVIEW_PICKED__).toBeUndefined();
    page.__MISTY_PREVIEW__.cancel();
    expect(page.__MISTY_PREVIEW_PICKED__).toBe("");
  });
});
