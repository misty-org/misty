import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MistyPanelDock } from "./MistyPanelDock";
import {
  MISTY_PANEL_MAX_WIDTH,
  MISTY_PANEL_MIN_WIDTH,
  MISTY_PANEL_WIDTH,
  useMistyPanelStore,
} from "./mistyPanelStore";

const suspend = vi.hoisted(() => vi.fn());
vi.mock("@/features/app-windows/page-runtime/browserOverlayRuntime", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setBrowserWebviewsSuspended: suspend,
}));

afterEach(() => {
  cleanup();
  useMistyPanelStore.setState({ chatOpen: false, width: MISTY_PANEL_WIDTH });
  localStorage.clear();
  suspend.mockClear();
});

const pointer = (target: EventTarget, type: string, at: { clientX?: number; clientY?: number }) =>
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...at }));
  });

const chat = <aside data-testid="chat" />;

describe("Chat panel width", () => {
  it("keeps the width within bounds", () => {
    useMistyPanelStore.getState().setWidth(10);
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_MIN_WIDTH);
    useMistyPanelStore.getState().setWidth(5_000);
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_MAX_WIDTH);
  });

  it("follows the pointer: dragging toward the page widens the panel", async () => {
    render(<MistyPanelDock views={["chat"]} side="right" chat={chat} />);
    // Let the opening slide finish; only opening and closing animate.
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    const edge = screen.getByRole("separator", { name: "Resize chat panel" });
    pointer(edge, "pointerdown", { clientX: 600 });
    expect(edge.dataset.dragging).toBe("true");
    // Pages pause while the edge moves, so a native page cannot swallow the drag.
    expect(suspend).toHaveBeenLastCalledWith(true, "misty-panel-resize");
    pointer(window, "pointermove", { clientX: 500 });
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH + 100);
    // A drag never animates: the width follows the pointer at once.
    const dock = edge.closest<HTMLElement>("[data-misty-panel-dock]")!;
    // The dock is the panel plus the margin of window chrome beside it.
    expect(dock.style.width).toBe(`${MISTY_PANEL_WIDTH + 100 + 6}px`);
    expect(dock.style.transitionDuration).toBe("");
    pointer(window, "pointermove", { clientX: 640 });
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH - 40);
    pointer(window, "pointerup", { clientX: 640 });
    expect(edge.dataset.dragging).toBeUndefined();
    expect(suspend).toHaveBeenLastCalledWith(false, "misty-panel-resize");
    // After release, moving the pointer no longer resizes.
    pointer(window, "pointermove", { clientX: 100 });
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH - 40);
  });

  it("resizes from the panel's inner edge", () => {
    render(<MistyPanelDock views={["chat"]} side="right" chat={chat} />);
    const edge = screen.getByRole("separator", { name: "Resize chat panel" });
    // On the right, the edge faces left: moving it left widens the panel.
    act(() => {
      fireEvent.keyDown(edge, { key: "ArrowLeft" });
    });
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH + 16);
    act(() => {
      fireEvent.keyDown(edge, { key: "ArrowRight", shiftKey: true });
    });
    expect(useMistyPanelStore.getState().width).toBe(
      Math.max(MISTY_PANEL_MIN_WIDTH, MISTY_PANEL_WIDTH + 16 - 64),
    );
    act(() => {
      fireEvent.doubleClick(edge);
    });
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH);
    const card = screen.getByTestId("chat").closest<HTMLElement>("[data-misty-panel-card]")!;
    expect(card.style.getPropertyValue("--misty-panel-width")).toBe(`${MISTY_PANEL_WIDTH}px`);
  });

  it("remembers its width on this device", () => {
    useMistyPanelStore.getState().setWidth(480);
    expect(localStorage.getItem("misty:misty-panel-width")).toBe("480");
    expect(useMistyPanelStore.getState().width).toBe(480);
    // The default leaves nothing behind.
    useMistyPanelStore.getState().setWidth(MISTY_PANEL_WIDTH);
    expect(localStorage.getItem("misty:misty-panel-width")).toBeNull();
  });
});

describe("Chat panel", () => {
  it("closes when its edge is pulled well past its narrowest", () => {
    useMistyPanelStore.setState({ chatOpen: true });
    render(<MistyPanelDock views={["chat"]} side="right" chat={chat} />);
    const edge = screen.getByRole("separator", { name: "Resize chat panel" });
    pointer(edge, "pointerdown", { clientX: 600 });
    pointer(window, "pointermove", { clientX: 600 + MISTY_PANEL_WIDTH });
    expect(useMistyPanelStore.getState().chatOpen).toBe(false);
    expect(suspend).toHaveBeenLastCalledWith(false, "misty-panel-resize");
  });
});
