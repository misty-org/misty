import { afterEach, expect, it, vi } from "vitest";
import { requireDesktopHost } from "./requireDesktopHost";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("blocks a hosted renderer before it can mount the application", () => {
  document.body.innerHTML = '<div id="root"></div>';
  expect(requireDesktopHost()).toBe(false);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Misty is a desktop app");
  expect(document.querySelector("button, input")).toBeNull();
});

it("requires a functioning native bridge, not just a marker", () => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  expect(requireDesktopHost()).toBe(false);
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn() });
  document.body.innerHTML = '<div id="root">Native startup</div>';
  expect(requireDesktopHost()).toBe(true);
  expect(document.getElementById("root")?.textContent).toBe("Native startup");
});
