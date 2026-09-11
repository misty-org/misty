import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { dockLeaves } from "@/features/workspace/dockTree";
import { setAppUnsaved } from "@/features/apps/appUpdateSafety";
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
function mount() {
  const state = useWorkspaceStore.getState();
  return render(
    <WorkspaceLayoutTabs
      focusedPaneId={state.layout.focusedPaneId}
      lastUsedTabByGroup={{}}
      onOpen={vi.fn()}
      onClose={vi.fn()}
      onOpenNewTab={vi.fn()}
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
  expect(screen.getByRole("button", { name: "Close tab New Tab" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show panes in New Tab" })).toBeNull();
  act(() => {
    useWorkspaceStore
      .getState()
      .splitPane(useWorkspaceStore.getState().layout.focusedPaneId, "right");
  });
  expect(screen.queryByRole("button", { name: "Close tab New Tab" })).toBeNull();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Show panes in New Tab" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  const closes = await screen.findAllByRole("menuitem", { name: "Close pane New Tab" });
  expect(closes).toHaveLength(2);
  fireEvent.click(closes[1]);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Close tab New Tab" })).toBeTruthy(),
  );
  expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(1);
});
it("does not close a pane with unsaved work from the dropdown", async () => {
  const state = useWorkspaceStore.getState();
  state.openSurface({
    surfaceId: "official-app",
    groupKey: "app:code",
    title: "Code",
    route: "/apps/code",
  });
  const code = dockLeaves(useWorkspaceStore.getState().layout.root)[0].tabs[0];
  state.splitPane(useWorkspaceStore.getState().layout.focusedPaneId, "right");
  mount();
  setAppUnsaved(code.id, true);
  try {
    fireEvent.pointerDown(screen.getByRole("button", { name: "Show panes in New Tab" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Close pane Code" }));
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(2);
  } finally {
    setAppUnsaved(code.id, false);
  }
});
