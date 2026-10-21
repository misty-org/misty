import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceLayout, WorkspacePane, WorkspaceView } from "@/features/workspace/model";
import { mistyPanelHost } from "./mistyPanelHost";
import { MistyPanelDock } from "./MistyPanelDock";
import {
  MISTY_PANEL_MAX_SPLIT,
  MISTY_PANEL_MAX_WIDTH,
  MISTY_PANEL_MIN_SPLIT,
  MISTY_PANEL_MIN_WIDTH,
  MISTY_PANEL_SPLIT,
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
  useMistyPanelStore.setState({
    open: false,
    chatOpen: false,
    paneId: null,
    width: MISTY_PANEL_WIDTH,
    chatWidth: MISTY_PANEL_WIDTH,
    split: MISTY_PANEL_SPLIT,
  });
  localStorage.clear();
  suspend.mockClear();
});

const pointer = (target: EventTarget, type: string, at: { clientX?: number; clientY?: number }) =>
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...at }));
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

  it("remembers each panel's width on this device", () => {
    useMistyPanelStore.getState().setWidth(480);
    useMistyPanelStore.getState().setWidth(520, "chat");
    expect(localStorage.getItem("misty:misty-panel-width")).toBe("480");
    expect(localStorage.getItem("misty:misty-chat-panel-width")).toBe("520");
    // The default leaves nothing behind.
    useMistyPanelStore.getState().setWidth(MISTY_PANEL_WIDTH, "chat");
    expect(localStorage.getItem("misty:misty-chat-panel-width")).toBeNull();
  });
});

describe("two Misty panels", () => {
  const renderBoth = () =>
    render(
      <MistyPanelDock views={["agents", "chat"]} side="right" chat={<aside data-testid="chat" />} />,
    );
  const card = (view: string) =>
    document.querySelector<HTMLElement>(`[data-misty-panel-card='${view}']`)!;

  it("are separate cards with a margin of chrome between them", () => {
    renderBoth();
    expect(screen.getByTestId("panel").closest("[data-misty-panel-card='agents']")).not.toBeNull();
    expect(screen.getByTestId("chat").closest("[data-misty-panel-card='chat']")).not.toBeNull();
    const gap = screen.getByRole("separator", { name: "Resize panels" });
    expect(gap.style.height).toBe("6px");
    expect(gap.previousElementSibling).toBe(card("agents"));
    expect(gap.nextElementSibling).toBe(card("chat"));
    expect(card("agents").style.flexGrow).toBe("0.5");
    expect(card("chat").style.flexGrow).toBe("0.5");
  });

  it("each resize their own width; the column is as wide as the widest", () => {
    renderBoth();
    const chatEdge = screen.getByRole("separator", { name: "Resize chat panel" });
    act(() => {
      fireEvent.keyDown(chatEdge, { key: "ArrowLeft", shiftKey: true });
    });
    expect(useMistyPanelStore.getState().chatWidth).toBe(MISTY_PANEL_WIDTH + 64);
    expect(useMistyPanelStore.getState().width).toBe(MISTY_PANEL_WIDTH);
    expect(card("chat").style.getPropertyValue("--misty-panel-width")).toBe(
      `${MISTY_PANEL_WIDTH + 64}px`,
    );
    expect(card("agents").style.getPropertyValue("--misty-panel-width")).toBe(
      `${MISTY_PANEL_WIDTH}px`,
    );
    const stack = document.querySelector<HTMLElement>("[data-misty-panel-stack]")!;
    expect(stack.style.width).toBe(`${MISTY_PANEL_WIDTH + 64}px`);
    // Each edge sits on its own card's inner outline.
    expect(chatEdge.style.right).toBe(`${MISTY_PANEL_WIDTH + 64 - 6}px`);
    const agentsEdge = screen.getByRole("separator", { name: "Resize Misty panel" });
    expect(agentsEdge.style.right).toBe(`${MISTY_PANEL_WIDTH - 6}px`);
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

  it("drag the gap between them to share the height, remembered on this device", () => {
    renderBoth();
    const stack = document.querySelector<HTMLElement>("[data-misty-panel-stack]")!;
    stack.getBoundingClientRect = () => ({ height: 806 }) as DOMRect;
    const gap = screen.getByRole("separator", { name: "Resize panels" });
    pointer(gap, "pointerdown", { clientY: 400 });
    expect(gap.dataset.dragging).toBe("true");
    expect(suspend).toHaveBeenLastCalledWith(true, "misty-panel-split");
    // The cards share 800px: 160px down moves the line by a fifth.
    pointer(window, "pointermove", { clientY: 560 });
    expect(useMistyPanelStore.getState().split).toBe(0.7);
    expect(card("agents").style.flexGrow).toBe("0.7");
    expect(Number(card("chat").style.flexGrow)).toBeCloseTo(0.3);
    // Neither card shrinks past its floor.
    pointer(window, "pointermove", { clientY: 2_000 });
    expect(useMistyPanelStore.getState().split).toBe(MISTY_PANEL_MAX_SPLIT);
    pointer(window, "pointermove", { clientY: -2_000 });
    expect(useMistyPanelStore.getState().split).toBe(MISTY_PANEL_MIN_SPLIT);
    pointer(window, "pointerup", { clientY: 0 });
    expect(gap.dataset.dragging).toBeUndefined();
    expect(localStorage.getItem("misty:misty-panel-split")).toBe(String(MISTY_PANEL_MIN_SPLIT));
    // A double-click shares it evenly again and forgets the saved split.
    act(() => {
      fireEvent.doubleClick(gap);
    });
    expect(useMistyPanelStore.getState().split).toBe(MISTY_PANEL_SPLIT);
    expect(localStorage.getItem("misty:misty-panel-split")).toBeNull();
  });

  it("arrow keys move the gap", () => {
    renderBoth();
    const gap = screen.getByRole("separator", { name: "Resize panels" });
    act(() => {
      fireEvent.keyDown(gap, { key: "ArrowDown", shiftKey: true });
    });
    expect(useMistyPanelStore.getState().split).toBe(0.6);
    act(() => {
      fireEvent.keyDown(gap, { key: "ArrowUp" });
    });
    expect(useMistyPanelStore.getState().split).toBe(0.575);
  });
});
