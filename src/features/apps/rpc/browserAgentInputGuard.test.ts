import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

const guard = Function(`return (${readFileSync(`${process.cwd()}/src-tauri/src/infra/browser_agent_input_guard.js`, "utf8")})`)();
const listeners: Array<[string, EventListener]> = [];

afterEach(() => {
  for (const [type, listener] of listeners.splice(0)) window.removeEventListener(type, listener, true);
  vi.restoreAllMocks();
  (window as any).__MISTY_AGENT_INPUT_OBSERVER__?.disconnect();
  delete (window as any).__MISTY_AGENT_INPUT_OBSERVER__;
  delete (window as any).__MISTY_AGENT_INPUT_LOCKED__;
  delete (window as any).__MISTY_AGENT_INPUT_GUARD__;
  document.body.innerHTML = "";
});

const install = () => {
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation(((type: string, listener: EventListener, options: AddEventListenerOptions) => {
    listeners.push([type, listener]);
    add(type, listener, options);
  }) as typeof window.addEventListener);
  guard(true);
};

it("suppresses an agent-triggered file picker while retaining site handlers and the upload input", () => {
  document.body.innerHTML = '<button>Upload</button><input type="file" hidden>';
  const file = document.querySelector("input")!;
  const click = vi.fn();
  const change = vi.fn();
  file.addEventListener("click", click);
  file.addEventListener("change", change);
  install();
  expect(file.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(false);
  expect(click).toHaveBeenCalledOnce();
  expect(file.isConnected).toBe(true);
  file.dispatchEvent(new Event("change", { bubbles: true }));
  expect(change).toHaveBeenCalledOnce();
  expect(document.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(true);
});

it("restores normal picker behavior on takeover without registering duplicate guards", () => {
  document.body.innerHTML = '<input type="file">';
  install();
  const count = listeners.length;
  guard(false);
  expect(listeners).toHaveLength(count);
  expect(document.querySelector("input")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(true);
});

it("continues to block trusted human input while the agent owns the view", () => {
  install();
  const event = { isTrusted: true, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
  listeners.find(([type]) => type === "click")![1](event as unknown as Event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
});

it("locks file pickers inside existing and newly inserted accessible frames, then releases both on takeover", async () => {
  document.body.innerHTML = '<iframe></iframe>';
  const first = document.querySelector("iframe")!;
  first.contentDocument!.body.innerHTML = '<input type="file">';
  install();
  const second = document.createElement("iframe");
  document.body.append(second);
  second.contentDocument!.body.innerHTML = '<input type="file">';
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const frame of [first, second]) {
    const view = frame.contentWindow as Window & typeof globalThis;
    expect(frame.contentDocument!.querySelector("input")!.dispatchEvent(new view.MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(false);
  }
  guard(false);
  for (const frame of [first, second]) {
    const view = frame.contentWindow as Window & typeof globalThis;
    expect(frame.contentDocument!.querySelector("input")!.dispatchEvent(new view.MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(true);
    (view as any).__MISTY_AGENT_INPUT_OBSERVER__?.disconnect();
  }
});
