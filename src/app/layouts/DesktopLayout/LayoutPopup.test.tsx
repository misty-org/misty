import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  configureWorkspaceDefaultView,
  dockLeaves,
  useLayoutEditor,
  useWorkspaceStore,
} from "@/features/app-windows";
import { LayoutPopup } from "./LayoutPopup";

beforeEach(() => {
  configureWorkspaceDefaultView(3);
  useWorkspaceStore.getState().reset();
  // Two tabs: the window shows the second, so the first list row is the one not yet placed.
  useWorkspaceStore.getState().newTab();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  act(() => useLayoutEditor.getState().stop());
  await new Promise((resolve) => setTimeout(resolve, 0));
});

function open() {
  render(<LayoutPopup onApplied={() => undefined} />);
  act(() => useLayoutEditor.getState().toggle());
  return screen.getAllByRole("listitem")[0].firstElementChild as HTMLElement;
}

function apply() {
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  return dockLeaves(useWorkspaceStore.getState().layout.root);
}

/** A pointer event the shared drag reads, as its own tests send them. */
function pointer(element: EventTarget, type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
  });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
  act(() => element.dispatchEvent(event));
}

it("adds a page pressed in the list to the current tab's layout and applies it", () => {
  fireEvent.click(open());
  expect(document.querySelectorAll("[data-layout-pane]")).toHaveLength(2);
  expect(apply()).toHaveLength(2);
});

it("splits a pane with a page dragged onto its side", () => {
  // The draft's one pane fills the canvas; list rows sit at the top left.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.hasAttribute("data-layout-pane")) return new DOMRect(300, 0, 600, 400);
    if (this.closest("li")) return new DOMRect(0, 0, 200, 32);
    return new DOMRect(0, 0, 1000, 1000);
  });
  const row = open();
  const shown = dockLeaves(useWorkspaceStore.getState().layout.root)[0].views[0];
  pointer(row, "pointerdown", 10, 10);
  pointer(window, "pointermove", 880, 200);
  pointer(window, "pointerup", 880, 200);
  const panes = apply();
  expect(panes).toHaveLength(2);
  // Dropped on the right edge, the page sits to the right of the one already shown.
  expect(panes[0].views[0].id).toBe(shown.id);
});
