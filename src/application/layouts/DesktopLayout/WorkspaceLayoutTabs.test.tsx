import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { dockLeaves } from "@/features/workspace/dockTree";
import { setWorkspaceUnsaved } from "@/features/workspace/unsavedChanges";
import { WorkspaceLayoutTabs } from "./WorkspaceLayoutTabs";
vi.mock("./WorkspaceDockTree", () => ({
  minimumForWorkspaceTabs: () => ({ width: 280, height: 180 }),
}));
vi.mock("./WorkspaceWindowMenu", () => ({ WorkspaceWindowMenu: () => null }));
vi.mock("./WindowsWorkspaceTitlebarControls", () => ({
  WindowsWorkspaceTitlebarControls: () => null,
  dockActionClass: "",
}));
beforeEach(() => {
  useWorkspaceStore.getState().reset();
  vi.stubGlobal("CSS", { escape: (value: string) => value });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount(position: "top" | "bottom" | "left" | "right" = "top") {
  const state = useWorkspaceStore.getState();
  return render(
    <WorkspaceLayoutTabs
      position={position}
      focusedPaneId={state.layout.focusedPaneId}
      lastUsedTabByGroup={{}}
      onOpen={vi.fn()}
      onClose={vi.fn()}
      onMoveTab={vi.fn(() => true)}
      onDockTab={vi.fn(() => true)}
      onSplitPane={vi.fn(() => null)}
      onClosePane={vi.fn()}
      virtualWindows={[]}
      activeVirtualWindowId={state.activeVirtualWindowId}
      canReopenVirtualWindow={false}
      onSelectVirtualWindow={vi.fn()}
      onCreateVirtualWindow={vi.fn()}
      onCloseVirtualWindow={vi.fn()}
      onReopenVirtualWindow={vi.fn()}
      onResizeSplit={vi.fn()}
      onNewTab={vi.fn()}
      onCloseLayoutTab={vi.fn()}
    />,
  );
}
it("shows only close for a single pane and only a dropdown for multiple panes", async () => {
  mount();
  expect(screen.getByRole("button", { name: "Close tab Google" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show panes in Google" })).toBeNull();
  act(() => {
    useWorkspaceStore
      .getState()
      .splitPane(useWorkspaceStore.getState().layout.focusedPaneId, "right");
  });
  expect(screen.queryByRole("button", { name: "Close tab Google" })).toBeNull();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Show panes in Google" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  const closes = await screen.findAllByRole("menuitem", { name: "Close pane Google" });
  expect(closes).toHaveLength(2);
  fireEvent.click(closes[1]);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Close tab Google" })).toBeTruthy(),
  );
  expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(1);
});
it("does not close a pane with unsaved work from the dropdown", async () => {
  const state = useWorkspaceStore.getState();
  const browser = dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs[0];
  state.splitPane(useWorkspaceStore.getState().layout.focusedPaneId, "right");
  mount();
  setWorkspaceUnsaved(browser.id, true);
  try {
    fireEvent.pointerDown(screen.getByRole("button", { name: "Show panes in Google" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click((await screen.findAllByRole("menuitem", { name: "Close pane Google" }))[0]);
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(2);
  } finally {
    setWorkspaceUnsaved(browser.id, false);
  }
});

it.each(["left", "right"] as const)(
  "keeps New tab before the scrolling list and supports vertical keys on the %s",
  (position) => {
    useWorkspaceStore.getState().newLayoutTab();
    mount(position);
    const list = screen.getByRole("tablist");
    const newTab = screen.getByRole("button", { name: "New tab" });
    expect(list.getAttribute("aria-orientation")).toBe("vertical");
    expect(list.contains(newTab)).toBe(false);
    expect(newTab.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[1], { key: "ArrowUp" });
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[0], { key: "End" });
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  },
);
