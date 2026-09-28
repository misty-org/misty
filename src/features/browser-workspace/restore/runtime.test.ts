import { afterEach, beforeAll, expect, it } from "vitest";
import runtimeSource from "../../../../src-tauri/src/infra/page_state/runtime.js?raw";

type Runtime = { run: (command: Record<string, unknown>) => any };
const runtime = () => (globalThis as unknown as { __mistyPageState: Runtime }).__mistyPageState;

beforeAll(() => {
  // jsdom has no layout; treat every element as visible.
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 }) as DOMRect;
  (globalThis as any).CSS ??= {
    escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"),
  };
  window.scrollTo = () => undefined;
  window.scrollBy = () => undefined;
  new Function(runtimeSource)();
});
afterEach(() => {
  document.body.innerHTML = "";
});

const form = () => {
  document.body.innerHTML = `
    <form>
      <label>Shirt size <input name="size" /></label>
      <label>Password <input type="password" name="pw" /></label>
      <select name="color"><option value="red">Red</option><option value="blue">Blue</option></select>
      <label><input type="checkbox" name="gift" /> Gift wrap</label>
      <button type="submit" id="send">Send</button>
      <button type="button" id="next">Next</button>
    </form>`;
};

it("describes fields as metadata and returns only requested values", () => {
  form();
  (document.querySelector('[name="size"]') as HTMLInputElement).value = "M";
  (document.querySelector('[name="pw"]') as HTMLInputElement).value = "hunter2";
  const described = runtime().run({ op: "describe", force: true });
  expect(JSON.stringify(described)).not.toContain("hunter2");
  expect(JSON.stringify(described)).not.toContain('"M"');
  const size = described.fields.find((f: any) => f.name === "size");
  expect(size.label).toBe("Shirt size");
  const values = runtime().run({ op: "values", keys: [size.key] });
  expect(values).toEqual([{ key: size.key, value: "M" }]);
});

it("restores values, marks secrets, and reports unplaced fields", () => {
  form();
  const described = runtime().run({ op: "describe", force: true });
  const byName = (name: string) => described.fields.find((f: any) => f.name === name);
  const saved = {
    url: location.href,
    scroll: { x: 0, y: 0 },
    ui: {},
    media: [],
    fingerprint: "",
    fields: [
      { ...byName("size"), class: "normal", value: "L" },
      { ...byName("color"), class: "normal", selected: ["blue"] },
      { ...byName("gift"), class: "normal", checked: true },
      { ...byName("pw"), class: "secret" },
      {
        key: "0|input|text|revealed-later",
        tag: "input",
        type: "text",
        locators: [["name", "revealed-later"]],
        class: "normal",
        value: "x",
      },
    ],
  };
  const report = runtime().run({ op: "apply", state: saved });
  expect((document.querySelector('[name="size"]') as HTMLInputElement).value).toBe("L");
  expect((document.querySelector('[name="color"]') as HTMLSelectElement).value).toBe("blue");
  expect((document.querySelector('[name="gift"]') as HTMLInputElement).checked).toBe(true);
  expect((document.querySelector('[name="pw"]') as HTMLInputElement).value).toBe("");
  expect(report.applied).toBe(3);
  expect(report.secrets).toBe(1);
  expect(report.unmatched).toEqual(["0|input|text|revealed-later"]);
});

it("refuses submit buttons and cross-origin links, and guards submission", () => {
  form();
  document.body.insertAdjacentHTML(
    "beforeend",
    '<a id="away" href="https://elsewhere.test/">Away</a>',
  );
  const controls = runtime().run({ op: "controls" });
  const ref = (id: string) => controls.find((c: any) => c.id === id)?.ref;
  expect(runtime().run({ op: "act", action: { type: "click", ref: ref("send") } })).toEqual({
    ok: false,
    error: "submit_blocked",
  });
  expect(runtime().run({ op: "act", action: { type: "click", ref: ref("away") } })).toEqual({
    ok: false,
    error: "navigation_blocked",
  });
  expect(runtime().run({ op: "act", action: { type: "click", ref: ref("next") } })).toEqual({
    ok: true,
  });
  expect(runtime().run({ op: "act", action: { type: "navigate", ref: ref("next") } })).toEqual({
    ok: false,
    error: "unsupported",
  });
  runtime().run({ op: "guard", on: true });
  const submitted = new Event("submit", { bubbles: true, cancelable: true });
  document.querySelector("form")!.dispatchEvent(submitted);
  expect(submitted.defaultPrevented).toBe(true);
  runtime().run({ op: "guard", on: false });
});
