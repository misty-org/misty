import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const script = readFileSync(
  new URL("../../src-tauri/src/infra/browser/scripts/passwords.js", import.meta.url),
  "utf8",
);
const host = readFileSync(
  new URL("../../src-tauri/src/infra/browser/host_messages/passwords.rs", import.meta.url),
  "utf8",
);

type TestWindow = Window & {
  __navigations: string[];
  __MISTY_PASSWORDS__: { fill(username: string, password: string): void; offer?: unknown };
};

/** The real script, then what any script on the site could do: hook the DOM and focus a field. */
function hostilePage() {
  const dom = new JSDOM(
    '<form><input id="user" type="text"><input id="pass" type="password"></form>',
    { runScripts: "outside-only", url: "https://example.com/login", pretendToBeVisual: true },
  );
  const window = dom.window as unknown as TestWindow;
  window.__navigations = [];
  for (const id of ["user", "pass"]) {
    // jsdom lays nothing out, so nothing counts as visible without this.
    (window.document.getElementById(id) as HTMLElement).getClientRects = () =>
      [{}] as unknown as DOMRectList;
  }
  dom.window.eval(`(() => {
    const shortcutToken = "secret-token";
    const encode = encodeURIComponent;
    const sendHostNavigation = (url) => window.__navigations.push(url);
    // jsdom's own focus events aren't trusted; a real engine's are, even for element.focus().
    ${script.replaceAll("!event.isTrusted || ", "")}
  })();`);
  dom.window.eval(`
    window.__captured = [];
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      window.__captured.push(listener);
      return original.call(this, type, listener, options);
    };
    window.__created = 0;
    const create = document.createElement.bind(document);
    document.createElement = (...args) => { window.__created += 1; return create(...args); };
  `);
  const focus = (id: string) => {
    window.document.getElementById(id)!.focus();
  };
  return { dom, window, focus };
}

const actions = (navigations: string[]) =>
  navigations.map((url) => new URL(url).pathname);

test("focusing a sign-in field tells Misty where it is and gives the page nothing", () => {
  const { window, focus } = hostilePage();
  focus("pass");
  assert.deepEqual(actions(window.__navigations), ["list"]);
  const message = new URL(window.__navigations[0]);
  for (const name of ["left", "bottom", "width", "token"]) {
    assert.ok(message.searchParams.has(name), name);
  }
  // Nothing was drawn in the page, so there are no rows or usernames to read or click.
  assert.equal((window as unknown as { __created: number }).__created, 0);
  assert.equal(window.document.querySelectorAll("button, [popover]").length, 0);
  assert.equal(window.__MISTY_PASSWORDS__.offer, undefined);
});

test("a page that hooks every listener still has nothing that asks for a fill", () => {
  const { window, focus } = hostilePage();
  focus("pass");
  const captured = (window as unknown as { __captured: ((event: unknown) => void)[] }).__captured;
  for (const listener of captured) {
    try {
      listener({ isTrusted: true, target: window.document.getElementById("pass"), key: "x" });
    } catch {
      // Whatever a forged event breaks, only the messages below matter.
    }
  }
  assert.ok(!actions(window.__navigations).includes("fill"));
  assert.equal((window.document.getElementById("pass") as HTMLInputElement).value, "");
});

test("the host has no fill message for a page to send", () => {
  assert.doesNotMatch(script, /send\('fill'/);
  assert.doesNotMatch(host, /"fill" =>/);
});

test("Misty's fill reaches the field, and coming back to it doesn't reopen the menu", () => {
  const { window, focus } = hostilePage();
  focus("pass");
  window.__navigations.length = 0;
  window.__MISTY_PASSWORDS__.fill("alice", "saved-password");
  assert.equal((window.document.getElementById("user") as HTMLInputElement).value, "alice");
  assert.equal((window.document.getElementById("pass") as HTMLInputElement).value, "saved-password");
  (window.document.getElementById("pass") as HTMLElement).blur();
  focus("pass");
  assert.ok(!actions(window.__navigations).includes("list"));
});

test("leaving the field closes the menu, and moving to the next field doesn't", async () => {
  const { window, focus } = hostilePage();
  focus("user");
  focus("pass");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(actions(window.__navigations), ["list", "list"]);
  (window.document.getElementById("pass") as HTMLElement).blur();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(actions(window.__navigations).at(-1), "hide");
});
