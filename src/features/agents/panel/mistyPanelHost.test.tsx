import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceLayout, WorkspacePane, WorkspaceView } from "@/features/workspace/model";
import { mistyPanelHost } from "./mistyPanelHost";
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

const pane = (id: string, surfaceId: string): WorkspacePane => ({
  type: "leaf",
  id,
  views: [{ id: `${id}-view`, surfaceId } as WorkspaceView],
  activeViewId: `${id}-view`,
});

const layout = (focusedPaneId: string, ...panes: WorkspacePane[]): WorkspaceLayout => {
  let root: WorkspaceLayout["root"] = panes[panes.length - 1];
  for (const first of panes.slice(0, -1).reverse())
    root = {
      type: "split",
      id: `${first.id}-split`,
      direction: "horizontal",
      ratio: 0.5,
      first,
      second: root,
    };
  return { focusedPaneId, root };
};

afterEach(() => {
  cleanup();
  useMistyPanelStore.setState({ open: false, paneId: null, width: MISTY_PANEL_WIDTH });
});

describe("where the Misty panel sits", () => {
  it("stays in the browser pane it was opened in", () => {
    const panes = layout("b", pane("a", "browser"), pane("b", "browser"));
    expect(mistyPanelHost(panes, "a")).toBe("a");
  });

  it("falls back to the focused browser pane, then the last one", () => {
    expect(mistyPanelHost(layout("b", pane("a", "browser"), pane("b", "browser")), null)).toBe("b");
    expect(mistyPanelHost(layout("f", pane("a", "browser"), pane("f", "files")), "gone")).toBe("a");
  });

  it("has no browser host when no pane shows a page", () => {
    expect(mistyPanelHost(layout("f", pane("f", "files")), null)).toBeNull();
  });
});

describe("Misty panel width", () => {
  it("keeps the width within bounds", () => {
    useMistyPanelStore.getState().setWidth(10);
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_MIN_WIDTH);
    useMistyPanelStore.getState().setWidth(5_000);
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_MAX_WIDTH);
  });

  it("follows the pointer: dragging toward the page widens the panel", async () => {
    render(<MistyPanelDock open side="right" />);
    // Let the opening slide finish; only opening and closing animate.
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    const edge = screen.getByRole("separator", { name: "Resize Misty panel" });
    const pointer = (target: EventTarget, type: string, clientX: number) =>
      act(() => {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX }));
      });
    pointer(edge, "pointerdown", 600);
    expect(edge.dataset.dragging).toBe("true");
    pointer(window, "pointermove", 500);
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH + 100);
    // A drag never animates: the width follows the pointer at once.
    const dock = edge.closest<HTMLElement>("[data-misty-panel-dock]")!;
    // The dock is the panel plus the margin of window chrome beside it.
    expect(dock.style.width).toBe(`${MISTY_PANEL_WIDTH + 100 + 8}px`);
    expect(dock.style.transitionDuration).toBe("");
    pointer(window, "pointermove", 640);
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH - 40);
    pointer(window, "pointerup", 640);
    expect(edge.dataset.dragging).toBeUndefined();
    // After release, moving the pointer no longer resizes.
    pointer(window, "pointermove", 100);
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH - 40);
  });

  it("resizes from the panel's inner edge", () => {
    render(<MistyPanelDock open side="right" />);
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
    const dock = screen.getByTestId("panel").closest<HTMLElement>("[data-misty-panel-dock]")!;
    expect(dock.style.getPropertyValue("--misty-panel-width")).toBe(`${MISTY_PANEL_WIDTH}px`);
  });
});
