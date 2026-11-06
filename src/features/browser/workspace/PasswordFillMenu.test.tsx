import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  fillPage: vi.fn(async () => {}),
  listener: undefined as undefined | ((event: { payload: unknown }) => void),
}));
vi.mock("@/features/passwords/api", () => ({ passwordsApi: { fillPage: native.fillPage } }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event, listener) => {
    native.listener = listener;
    return () => {};
  }),
}));

import { listenForPasswordMenus, usePasswordMenuStore } from "@/features/passwords/fillMenu";
import { FIELD_MENU_CLICK_DELAY_MS as PASSWORD_MENU_CLICK_DELAY_MS } from "@/features/webviews/pageFieldMenu";
import { PasswordFillMenu } from "./PasswordFillMenu";

const offer = (logins = [{ id: "login:1", username: "alice@example.com" }]) => ({
  id: "page-1",
  origin: "https://example.com",
  logins,
  place: { left: 0.1, bottom: 0.2, width: 0.3 },
});

let now = 1000;
beforeEach(() => {
  vi.clearAllMocks();
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  usePasswordMenuStore.setState({ menus: {}, held: null, closeWhenReleased: false });
  document.body.innerHTML =
    '<div data-browser-workspace-tab="tab-1"><div data-browser-page-host></div></div>';
  listenForPasswordMenus();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const send = (payload: unknown) => act(() => native.listener?.({ payload }));
const show = () => render(<PasswordFillMenu tabId="tab-1" runtimeId="page-1" active />);

it("registers as a notice so the page keeps working around it", () => {
  show();
  send(offer());
  expect(screen.getByRole("listbox").getAttribute("data-misty-notification")).toBe("true");
  expect(screen.getByRole("option").textContent).toBe("alice@example.com");
});

it("ignores a click that lands right after the menu appears", () => {
  show();
  send(offer());
  now += PASSWORD_MENU_CLICK_DELAY_MS - 1;
  fireEvent.click(screen.getByRole("option"));
  expect(native.fillPage).not.toHaveBeenCalled();
  expect(screen.queryByRole("option")).not.toBeNull();
});

it("starts the wait again when the page reopens or moves the menu", () => {
  show();
  send(offer());
  now += PASSWORD_MENU_CLICK_DELAY_MS;
  send(offer());
  fireEvent.click(screen.getByRole("option"));
  expect(native.fillPage).not.toHaveBeenCalled();
});

it("fills the clicked sign-in once the wait has passed, then closes", () => {
  show();
  send(offer());
  now += PASSWORD_MENU_CLICK_DELAY_MS;
  fireEvent.click(screen.getByRole("option"));
  expect(native.fillPage).toHaveBeenCalledWith("page-1", "login:1");
  expect(screen.queryByRole("option")).toBeNull();
});

it("closes when the field loses focus, but not from under the pointer", () => {
  show();
  send(offer());
  fireEvent.pointerEnter(screen.getByRole("listbox"));
  send(offer([]));
  expect(screen.queryByRole("option")).not.toBeNull();
  fireEvent.pointerLeave(screen.getByRole("listbox"));
  expect(screen.queryByRole("option")).toBeNull();
});

it("shows only on the active tab", () => {
  render(<PasswordFillMenu tabId="tab-1" runtimeId="page-1" active={false} />);
  send(offer());
  expect(screen.queryByRole("option")).toBeNull();
});
