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
it("fades only the edges with tabs outside the visible scroll area", () => {
  mount();
  const list = screen.getByRole("tablist");
  Object.defineProperties(list, {
    clientWidth: { configurable: true, value: 200 },
    scrollWidth: { configurable: true, value: 400 },
  });
  fireEvent.scroll(list);
  expect(list.style.getPropertyValue("--tab-fade-start")).toBe("0px");
  expect(list.style.getPropertyValue("--tab-fade-end")).toBe("16px");

  list.scrollLeft = 100;
  fireEvent.scroll(list);
  expect(list.style.getPropertyValue("--tab-fade-start")).toBe("16px");
  expect(list.style.getPropertyValue("--tab-fade-end")).toBe("16px");

  list.scrollLeft = 200;
  fireEvent.scroll(list);
  expect(list.style.getPropertyValue("--tab-fade-start")).toBe("16px");
  expect(list.style.getPropertyValue("--tab-fade-end")).toBe("0px");

  Object.defineProperty(list, "clientWidth", { value: 400 });
  list.scrollLeft = 0;
  fireEvent.scroll(list);
  expect(list.style.getPropertyValue("--tab-fade-start")).toBe("0px");
  expect(list.style.getPropertyValue("--tab-fade-end")).toBe("0px");
});

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

it.each(["top", "bottom", "left", "right"] as const)(
  "collapses and reopens a group from the %s strip",
  (position) => {
    const store = useWorkspaceStore.getState();
    const first = store.layout.activeLayoutTabId!;
    store.newLayoutTab();
    const second = useWorkspaceStore.getState().layout.activeLayoutTabId!;
    const id = store.createTabGroup([first, second], "Reading")!;
    mount(position);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Reading, 2 tabs, expanded" }));
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(
      screen
        .getByRole("button", { name: "Reading, 2 tabs, collapsed" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    act(() => {
      useWorkspaceStore.getState().reopenTabGroup(id);
    });
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Edit group Reading" })).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Reading, 2 tabs, expanded" }));
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Research" } });
    fireEvent.click(screen.getByRole("button", { name: "green" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(useWorkspaceStore.getState().tabGroups.find((g) => g.id === id)).toMatchObject({
      name: "Research",
      color: "green",
    });
  },
);

it("moves an expanded group past its own members with the keyboard", () => {
  const state = useWorkspaceStore.getState();
  const first = state.layout.activeLayoutTabId!;
  state.newLayoutTab();
  const second = useWorkspaceStore.getState().layout.activeLayoutTabId!;
  state.createTabGroup([first, second], "Reading");
  state.newLayoutTab();
  const outside = useWorkspaceStore.getState().layout.activeLayoutTabId!;
  mount();
  fireEvent.keyDown(screen.getByRole("button", { name: "Reading, 2 tabs, expanded" }), {
    key: "ArrowRight",
    altKey: true,
    shiftKey: true,
  });
  expect(useWorkspaceStore.getState().layout.tabs?.map((tab) => tab.id)).toEqual([
    outside,
    first,
    second,
  ]);
});

it.each(["release", "cancel"] as const)("handles a group pointer drag on %s", (finish) => {
  const state = useWorkspaceStore.getState();
  const first = state.layout.activeLayoutTabId!;
  state.newLayoutTab();
  const second = useWorkspaceStore.getState().layout.activeLayoutTabId!;
  state.createTabGroup([first, second], "Reading");
  state.newLayoutTab();
  const outside = useWorkspaceStore.getState().layout.activeLayoutTabId!;
  const rects = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-reorder-list")) return new DOMRect(0, 0, 500, 40);
      const item = this.closest<HTMLElement>("[data-reorder-item]");
      if (!item) return new DOMRect(0, 0, 600, 400);
      return new DOMRect([...item.parentElement!.children].indexOf(item) * 100, 0, 100, 32);
    });
  const pointer = (target: EventTarget, type: string, x: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: 16,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    });
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
    act(() => {
      target.dispatchEvent(event);
    });
  };
  try {
    mount();
    pointer(screen.getByRole("button", { name: "Reading, 2 tabs, expanded" }), "pointerdown", 30);
    pointer(window, "pointermove", 390);
    expect(document.querySelector(".pointer-reorder-indicator")).toBeTruthy();
    expect(useWorkspaceStore.getState().layout.tabs?.map((tab) => tab.id)).toEqual([
      first,
      second,
      outside,
    ]);
    if (finish === "cancel") fireEvent.keyDown(window, { key: "Escape" });
    else pointer(window, "pointerup", 390);
    expect(useWorkspaceStore.getState().layout.tabs?.map((tab) => tab.id)).toEqual(
      finish === "cancel" ? [first, second, outside] : [outside, first, second],
    );
    expect(document.querySelector(".pointer-reorder-shield")).toBeNull();
  } finally {
    rects.mockRestore();
  }
});

it("creates groups through a portaled context submenu without a toolbar group button", async () => {
  mount();
  expect(screen.queryByRole("button", { name: "Tab groups" })).toBeNull();
  fireEvent.contextMenu(screen.getByRole("tab"), { clientX: 100, clientY: 20 });
  const trigger = await screen.findByRole("menuitem", { name: "Add tab to group" });
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
  const create = await screen.findByRole("menuitem", { name: "New group" });
  const submenu = create.closest('[data-slot="context-menu-sub-content"]')!;
  expect(submenu.closest('[data-slot="context-menu-content"]')).toBeNull();
  fireEvent.click(create);
  expect(useWorkspaceStore.getState().tabGroups).toHaveLength(1);
  expect(await screen.findByLabelText("Group name")).toBeTruthy();
});

it.each(["ContextMenu", "F10"])("opens group configuration using %s", (key) => {
  const state = useWorkspaceStore.getState();
  state.createTabGroup([state.layout.activeLayoutTabId!], "Reading");
  mount();
  const label = screen.getByRole("button", { name: "Reading, 1 tab, expanded" });
  expect(label.textContent).toBe("Reading");
  fireEvent.keyDown(label, { key, shiftKey: key === "F10" });
  expect(screen.getByLabelText("Group name")).toBeTruthy();
  expect(label.getAttribute("aria-expanded")).toBe("true");
});
