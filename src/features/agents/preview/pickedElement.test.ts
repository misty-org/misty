import { describe, expect, it } from "vitest";
import {
  formatElementBlock,
  readPickedElement,
  sizeLabel,
  withElementBlock,
  type PickedElement,
} from "./pickedElement";

const button: PickedElement = {
  url: "http://localhost:3000/",
  selector: "#buy",
  tag: "button",
  id: "buy",
  classes: ["primary", "wide"],
  text: "Buy now",
  rect: { x: 24.4, y: 180.6, width: 319.5, height: 48 },
  styles: { display: "flex", color: "rgb(255, 255, 255)", font: "600 14px/20px Inter" },
  html: '<button id="buy" class="primary wide">Buy now</button>',
  htmlTruncated: false,
  errors: [],
};

describe("readPickedElement", () => {
  it("keeps the known fields and drops the rest", () => {
    const read = readPickedElement({
      ...button,
      styles: { ...button.styles, cursor: "pointer", display: 7 },
      extra: "ignored",
      viewport: { width: 800, height: 600 },
    });
    expect(read).toEqual({
      ...button,
      styles: { color: button.styles.color, font: button.styles.font },
    });
  });

  it("refuses a report with no selector or tag", () => {
    expect(readPickedElement(null)).toBeNull();
    expect(readPickedElement("button")).toBeNull();
    expect(readPickedElement({ tag: "div" })).toBeNull();
    expect(readPickedElement({ selector: "#a" })).toBeNull();
  });

  it("cuts oversized and wrongly typed values", () => {
    const read = readPickedElement({
      selector: "div",
      tag: "div",
      text: "x".repeat(5000),
      html: "y".repeat(9000),
      classes: ["ok", 3, "z".repeat(500)],
      rect: { x: "1", y: Number.NaN, width: 10, height: 20 },
      errors: Array.from({ length: 30 }, (_, index) => `error ${index}`),
    });
    expect(read?.text).toHaveLength(240);
    expect(read?.html).toHaveLength(4200);
    expect(read?.classes).toEqual(["ok", "z".repeat(128)]);
    expect(read?.rect).toEqual({ x: 0, y: 0, width: 10, height: 20 });
    expect(read?.errors).toHaveLength(8);
  });
});

describe("formatElementBlock", () => {
  it("lists the element's details and HTML in fenced blocks", () => {
    expect(formatElementBlock(button)).toBe(
      [
        "About this element in my app's preview (http://localhost:3000/):",
        "",
        "```",
        "selector: #buy",
        "tag: button",
        "id: buy",
        "classes: primary wide",
        "text: Buy now",
        "box: 320 × 48 at 24, 181",
        "display: flex",
        "color: rgb(255, 255, 255)",
        "font: 600 14px/20px Inter",
        "```",
        "",
        "```html",
        '<button id="buy" class="primary wide">Buy now</button>',
        "```",
        "",
        "",
      ].join("\n"),
    );
  });

  it("uses a longer fence when the HTML holds backticks, and says when it was cut", () => {
    const block = formatElementBlock({
      ...button,
      html: "<pre>```js\nrun()\n```</pre>",
      htmlTruncated: true,
    });
    expect(block).toContain("````html\n<pre>```js\nrun()\n```</pre>\n````\n(HTML cut at 4 KB)");
  });

  it("adds the page's recent errors", () => {
    const block = formatElementBlock({ ...button, errors: ["TypeError: x is undefined"] });
    expect(block).toContain("Recent errors on the page:\n```\nTypeError: x is undefined\n```");
  });
});

describe("withElementBlock", () => {
  it("keeps what the person already wrote", () => {
    expect(withElementBlock("", button)).toBe(formatElementBlock(button));
    expect(withElementBlock("Make this bigger  \n", button)).toBe(
      `Make this bigger\n\n${formatElementBlock(button)}`,
    );
  });
});

describe("sizeLabel", () => {
  it("rounds to whole pixels", () => {
    expect(sizeLabel(button)).toBe("320 × 48");
  });
});
