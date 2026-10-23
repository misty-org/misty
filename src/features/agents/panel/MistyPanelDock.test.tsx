import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MistyPanelDock } from "./MistyPanelDock";
import {
  MISTY_PANEL_MAX_WIDTH,
  MISTY_PANEL_MIN_WIDTH,
  MISTY_PANEL_WIDTH,
  useMistyPanelStore,
} from "./mistyPanelStore";

vi.mock("./MistyPanel", () => ({
  MistyPanel: () => <aside data-testid="panel" />,
}));

const suspend = vi.hoisted(() => vi.fn());
vi.mock("@/features/webviews/browserRuntime", () => ({
  setBrowserWebviewsSuspended: suspend,
  onBrowserRuntimeClose: () => () => undefined,
}));

afterEach(() => {
  cleanup();
  useMistyPanelStore.setState({
    open: false,
    chatOpen: false,
    paneId: null,
    width: MISTY_PANEL_WIDTH,
    chatWidth: MISTY_PANEL_WIDTH,
  });
  localStorage.clear();
  suspend.mockClear();
});

const pointer = (target: EventTarget, type: string, at: { clientX?: number; clientY?: number }) =>
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...at }));
  });

describe("Misty panel width", () => {
  it("keeps the width within bounds", () => {
    useMistyPanelStore.getState().setWidth(10);
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_MIN_WIDTH);
    useMistyPanelStore.getState().setWidth(5_000);
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_MAX_WIDTH);
  });

  it("follows the pointer: dragging toward the page widens the panel", async () => {
    render(<MistyPanelDock views={["agents"]} side="right" />);
    // Let the opening slide finish; only opening and closing animate.
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    const edge = screen.getByRole("separator", { name: "Resize Misty panel" });
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
    render(<MistyPanelDock views={["agents"]} side="right" />);
    const edge = screen.getByRole("separator", { name: "Resize Misty panel" });
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
    const card = screen.getByTestId("panel").closest<HTMLElement>("[data-misty-panel-card]")!;
    expect(card.style.getPropertyValue("--misty-panel-width")).toBe(`${MISTY_PANEL_WIDTH}px`);
  });

  it("remembers one width for both panels on this device", () => {
    useMistyPanelStore.getState().setWidth(480);
    expect(localStorage.getItem("misty:misty-panel-width")).toBe("480");
    expect(useMistyPanelStore.getState().chatWidth).toBe(480);
    // The default leaves nothing behind.
    useMistyPanelStore.getState().setWidth(MISTY_PANEL_WIDTH);
    expect(localStorage.getItem("misty:misty-panel-width")).toBeNull();
  });
});

describe("two Misty panels", () => {
  const renderBoth = () =>
    render(
      <MistyPanelDock
        views={["agents", "chat"]}
        side="right"
        chat={<aside data-testid="chat" />}
      />,
    );
  const card = (view: string) =>
    document.querySelector<HTMLElement>(`[data-misty-panel-card='${view}']`)!;

  it("are separate cards with a margin of chrome between them, the same height", () => {
    renderBoth();
    expect(screen.getByTestId("panel").closest("[data-misty-panel-card='agents']")).not.toBeNull();
    expect(screen.getByTestId("chat").closest("[data-misty-panel-card='chat']")).not.toBeNull();
    const gap = card("agents").nextElementSibling as HTMLElement;
    expect(gap.style.height).toBe("6px");
    expect(gap.nextElementSibling).toBe(card("chat"));
    expect(card("agents").style.flexGrow).toBe("1");
    expect(card("chat").style.flexGrow).toBe("1");
  });

  it("are always the same width, so they line up", () => {
    renderBoth();
    const chatEdge = screen.getByRole("separator", { name: "Resize chat panel" });
    act(() => {
      fireEvent.keyDown(chatEdge, { key: "ArrowLeft", shiftKey: true });
    });
    const wide = `${MISTY_PANEL_WIDTH + 64}px`;
    expect(useMistyPanelStore.getState().chatWidth).toBe(MISTY_PANEL_WIDTH + 64);
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH + 64);
    expect(card("chat").style.getPropertyValue("--misty-panel-width")).toBe(wide);
    expect(card("agents").style.getPropertyValue("--misty-panel-width")).toBe(wide);
    const stack = document.querySelector<HTMLElement>("[data-misty-panel-stack]")!;
    expect(stack.style.width).toBe(wide);
    // Each edge sits on its own card's inner outline.
    expect(chatEdge.style.right).toBe(`${MISTY_PANEL_WIDTH + 64 - 6}px`);
    const agentsEdge = screen.getByRole("separator", { name: "Resize Misty panel" });
    expect(agentsEdge.style.right).toBe(`${MISTY_PANEL_WIDTH + 64 - 6}px`);
  });

  it("pulling one card's edge shut closes only that card", () => {
    useMistyPanelStore.setState({ open: true, chatOpen: true });
    renderBoth();
    const chatEdge = screen.getByRole("separator", { name: "Resize chat panel" });
    pointer(chatEdge, "pointerdown", { clientX: 600 });
    pointer(window, "pointermove", { clientX: 600 + MISTY_PANEL_WIDTH });
    expect(useMistyPanelStore.getState().chatOpen).toBe(false);
    expect(useMistyPanelStore.getState().open).toBe(true);
    expect(suspend).toHaveBeenLastCalledWith(false, "misty-panel-resize");
  });
});
