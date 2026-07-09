import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const loads = vi.hoisted(() => ({ host: vi.fn(), cursor: vi.fn() }));
vi.mock("./hostMain", () => {
  loads.host();
  return { startup: Promise.resolve() };
});
vi.mock("./cursorEntry", () => {
  loads.cursor();
  return { cursorStartup: Promise.resolve() };
});
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
  history.replaceState(null, "", "/");
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  document.body.removeAttribute("style");
  document.body.innerHTML = "";
});
describe("desktop renderer isolation during updates", () => {
  it("never mounts the host app in a legacy cursor overlay", async () => {
    history.replaceState(null, "", "/index.html?cursor_companion=1");
    await (
      await import("./main")
    ).startup;
    expect(loads.cursor).toHaveBeenCalledOnce();
    expect(loads.host).not.toHaveBeenCalled();
  });
  it("replaces the obsolete controls window with an update message", async () => {
    history.replaceState(null, "", "/index.html?cursor_companion=controls");
    await (
      await import("./main")
    ).startup;
    expect(document.body.textContent).toContain("Companion controls have moved to Agents");
    expect(loads.host).not.toHaveBeenCalled();
    expect(loads.cursor).not.toHaveBeenCalled();
  });
  it("boots the ordinary host window normally", async () => {
    history.replaceState(null, "", "/agents");
    await (
      await import("./main")
    ).startup;
    expect(loads.host).toHaveBeenCalledOnce();
    expect(loads.cursor).not.toHaveBeenCalled();
  });
});
