import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: { payload: typeof menu }) => Promise<void>),
  invoke: vi.fn(async () => {}),
  suspend: vi.fn(),
  focus: vi.fn(async () => {}),
  stop: vi.fn(),
}));
vi.mock("@/features/browser/browserRuntime", () => ({
  browserOverlayReady: vi.fn(async () => {}),
  setBrowserWebviewsSuspended: native.suspend,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event, listener) => {
    native.listener = listener;
    return native.stop;
  }),
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setFocus: native.focus }),
}));
import { BrowserContextMenuBridge, BrowserContextMenuView } from "./BrowserContextMenuBridge";
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
const menu = {
  key: "native-key",
  x: 0.6,
  y: 0.4,
  actions: ["ask", "separator", "copy-link", "open-link"],
};
it("uses the shared menu with Ask first and only host-admitted actions", () => {
  const select = vi.fn();
  render(<BrowserContextMenuView menu={menu} onSelect={select} />);
  expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
    "Ask Misty…",
    "Copy Link Address",
    "Open Link in Misty Browser",
  ]);
  expect(screen.queryByText("Create task…")).toBeNull();
  fireEvent.click(screen.getByText("Ask Misty…"));
  expect(select).toHaveBeenCalledWith("ask");
});
it("supports keyboard navigation and Escape dismissal", async () => {
  const select = vi.fn();
  render(<BrowserContextMenuView menu={menu} onSelect={select} />);
  const root = screen.getByRole("menu");
  fireEvent.keyDown(root, { key: "ArrowDown" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByText("Ask Misty…").closest('[role="menuitem"]'),
    ),
  );
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByText("Copy Link Address").closest('[role="menuitem"]'),
    ),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(select).toHaveBeenCalledWith("dismiss");
});

it("closes the overlay and dispatches a native selection only once", async () => {
  render(<BrowserContextMenuBridge />);
  await act(async () => {
    await native.listener!({ payload: menu });
  });
  expect(native.suspend).toHaveBeenCalledWith(true, "browser-context-menu");
  expect(native.focus).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("Ask Misty…"));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("browser_context_menu_select", {
    key: "native-key",
    action: "ask",
  });
  expect(native.suspend).toHaveBeenLastCalledWith(false, "browser-context-menu");
});
it("releases the native menu and suspension on unmount", async () => {
  const ui = render(<BrowserContextMenuBridge />);
  await act(async () => {
    await native.listener!({ payload: menu });
  });
  ui.unmount();
  expect(native.invoke).toHaveBeenCalledWith("browser_context_menu_select", {
    key: "native-key",
    action: "dismiss",
  });
  expect(native.suspend).toHaveBeenLastCalledWith(false, "browser-context-menu");
});

it("grants menu focus to the local host without granting remote pages native access", () => {
  const capability = JSON.parse(
    readFileSync(`${process.cwd()}/src-tauri/capabilities/default.json`, "utf8"),
  );
  expect(capability.permissions).toContain("core:webview:allow-set-webview-focus");
  expect(capability.webviews).toEqual(["main"]);
  expect(capability.windows).toBeUndefined();
  expect(capability.remote).toBeUndefined();
  expect(capability.local).not.toBe(false);
});

it("releases the page if native focus fails and allows the next menu to open", async () => {
  native.focus.mockRejectedValueOnce(new Error("Focus unavailable"));
  render(<BrowserContextMenuBridge />);
  await act(async () => {
    await native.listener!({ payload: menu });
  });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("Focus unavailable");
  expect(native.suspend).toHaveBeenLastCalledWith(false, "browser-context-menu");
  expect(native.invoke).toHaveBeenCalledWith("browser_context_menu_select", {
    key: menu.key,
    action: "dismiss",
  });
  await act(async () => {
    await native.listener!({ payload: { ...menu, key: "retry-key" } });
  });
  expect(screen.getByRole("menu")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
