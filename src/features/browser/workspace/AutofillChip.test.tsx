import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  open: vi.fn(async () => {}),
  listener: undefined as undefined | ((event: { payload: unknown }) => void),
}));
vi.mock("@/features/autofill/api", () => ({ autofillApi: { open: native.open } }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event, listener) => {
    native.listener = listener;
    return () => {};
  }),
}));

import { listenForAutofillChips, useAutofillChipStore } from "@/features/autofill/chip";
import { FIELD_MENU_CLICK_DELAY_MS } from "@/features/webviews/pageFieldMenu";
import { AutofillChip } from "./AutofillChip";

const offer = (kind: "address" | "card" | null) => ({
  id: "page-1",
  kind,
  place: { left: 0.1, bottom: 0.2 },
});

let now = 1000;
beforeEach(() => {
  vi.clearAllMocks();
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  useAutofillChipStore.setState({ menus: {}, held: null, closeWhenReleased: false });
  document.body.innerHTML =
    '<div data-browser-workspace-tab="tab-1"><div data-browser-page-host></div></div>';
  listenForAutofillChips();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const send = (payload: unknown) => act(() => native.listener?.({ payload }));
const show = () => render(<AutofillChip tabId="tab-1" runtimeId="page-1" active />);

it("names the kind, and registers as a notice so the page keeps working around it", () => {
  show();
  send(offer("card"));
  expect(screen.getByRole("option").textContent).toBe("Fill card");
  expect(screen.getByRole("listbox").getAttribute("data-misty-notification")).toBe("true");
});

it("ignores a click that lands right after it appears, or after the page reopens it", () => {
  show();
  send(offer("address"));
  now += FIELD_MENU_CLICK_DELAY_MS - 1;
  fireEvent.click(screen.getByRole("option"));
  now += 1;
  send(offer("address"));
  fireEvent.click(screen.getByRole("option"));
  expect(native.open).not.toHaveBeenCalled();
});

it("opens the list where the field is once the wait has passed, then closes", () => {
  show();
  send(offer("address"));
  now += FIELD_MENU_CLICK_DELAY_MS;
  fireEvent.click(screen.getByRole("option"));
  expect(native.open).toHaveBeenCalledWith("page-1", "address", 0.1, 0.2);
  expect(screen.queryByRole("option")).toBeNull();
});

it("closes when the field loses focus, but not from under the pointer", () => {
  show();
  send(offer("address"));
  fireEvent.pointerEnter(screen.getByRole("listbox"));
  send(offer(null));
  expect(screen.queryByRole("option")).not.toBeNull();
  fireEvent.pointerLeave(screen.getByRole("listbox"));
  expect(screen.queryByRole("option")).toBeNull();
});

it("shows only on the active tab", () => {
  render(<AutofillChip tabId="tab-1" runtimeId="page-1" active={false} />);
  send(offer("address"));
  expect(screen.queryByRole("option")).toBeNull();
});
