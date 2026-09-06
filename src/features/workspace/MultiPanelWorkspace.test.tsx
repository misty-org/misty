import { MultiPanelWorkspace } from "./MultiPanelWorkspace";
import { createMultiPanelStore } from "./useMultiPanelStore";
import { act } from "react";
import { renderExplorerBottomBar } from "@/features/files/explorer/workspace/ExplorerWorkspaceChrome";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("MultiPanelWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("omits its tab strip when a parent workspace owns the tabs", async () => {
    const store = createMultiPanelStore({ idPrefix: "embedded-files" });
    store.getState().initialize("/Users/demo", "demo");

    await act(async () => {
      root.render(
        <MultiPanelWorkspace
          store={store}
          showTabStrip={false}
          renderPane={(_, path) => <output>{path}</output>}
        />,
      );
    });

    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector("output")?.textContent).toBe("/Users/demo");
    expect(container.querySelector("section")?.className).toContain("grid-rows-[minmax(0,1fr)]");
  });

  it("keeps the tab strip for a standalone workspace", async () => {
    const store = createMultiPanelStore({ idPrefix: "standalone-files" });
    store.getState().initialize("/Users/demo", "demo");

    await act(async () => {
      root.render(
        <MultiPanelWorkspace store={store} renderPane={(_, path) => <output>{path}</output>} />,
      );
    });

    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it("keeps intentionally split panes mounted", async () => {
    const store = createMultiPanelStore({ idPrefix: "split-files" });
    store.getState().initialize("/Users/demo", "demo");
    const firstPaneId = store.getState().activePaneId;
    store.getState().splitPane(firstPaneId, "vertical");

    await act(async () => {
      root.render(
        <MultiPanelWorkspace
          store={store}
          renderPane={(paneId) => <output data-pane={paneId}>{paneId}</output>}
        />,
      );
    });

    expect(container.querySelectorAll("output")).toHaveLength(2);
    expect(store.getState().tabs[0]?.panes).toHaveLength(2);
  });

  it("makes the file pane containing keyboard focus active", async () => {
    const store = createMultiPanelStore({ idPrefix: "focused-files" });
    store.getState().initialize("/Users/demo", "demo");
    const firstPaneId = store.getState().activePaneId;
    store.getState().splitPane(firstPaneId, "vertical");

    await act(async () => {
      root.render(
        <MultiPanelWorkspace
          store={store}
          renderPane={(paneId) => <button type="button">Focus {paneId}</button>}
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLElement>(`[data-multi-panel-pane="${firstPaneId}"] button`)
        ?.focus();
    });

    expect(store.getState().activePaneId).toBe(firstPaneId);
  });

  it("resizes a split with the keyboard", async () => {
    const store = createMultiPanelStore({ idPrefix: "keyboard-resize-files" });
    store.getState().initialize("/Users/demo", "demo");
    store.getState().splitPane(store.getState().activePaneId, "vertical");

    await act(async () => {
      root.render(
        <MultiPanelWorkspace store={store} renderPane={(_, path) => <output>{path}</output>} />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLElement>('[aria-label="Resize side-by-side file panes"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });

    expect(store.getState().tabs[0]?.layout.gridSplitRatio).toBe(0.45);
  });

  it("lets a workspace provide its own new-tab control", async () => {
    const store = createMultiPanelStore({ idPrefix: "custom-add-tab" });
    store.getState().initialize("/Users/demo/Documents", "Documents");

    await act(async () => {
      root.render(
        <MultiPanelWorkspace
          store={store}
          renderAddTabControl={(_, addTab) => (
            <button type="button" onClick={() => addTab("/Users/demo", "Home")}>
              New Home tab
            </button>
          )}
          renderPane={(_, path) => <output>{path}</output>}
        />,
      );
    });

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "New Home tab")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(store.getState().tabs.map((tab) => tab.path)).toEqual([
      "/Users/demo/Documents",
      "/Users/demo",
    ]);
  });

  it("keeps navigation and preview available inside an 800px embedded Files pane", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const store = createMultiPanelStore({ idPrefix: "compact-files" });
    store.getState().initialize("/Users/demo", "demo");
    const peer = createMultiPanelStore({ idPrefix: "other-files" });
    peer.getState().initialize("/Users/other", "other");
    await act(async () => {
      root.render(
        <MultiPanelWorkspace
          store={store}
          showTabStrip={false}
          renderNavigationAside={<nav aria-label="Files folders">Documents</nav>}
          navigationAsideWidth={220}
          renderAside={<aside>File details</aside>}
          renderBottomBar={renderExplorerBottomBar}
          renderPane={(_, path) => <output>{path}</output>}
        />,
      );
    });
    expect(container.querySelector('nav[aria-label="Files folders"]')).not.toBeNull();
    expect(container.querySelector("nav")?.parentElement?.className).not.toContain(
      "max-[980px]:hidden",
    );
    expect(container.querySelector("aside")?.textContent).toBe("File details");
    expect(container.querySelector('[aria-label="Resize preview panel"]')).not.toBeNull();
    expect(container.querySelector("aside")?.className).not.toContain("max-[980px]:hidden");
    const button = container.querySelector<HTMLButtonElement>('button[title="Hide sidebar"]');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(store.getState().tabs[0].sidebarVisible).toBe(false);
    expect(peer.getState().tabs[0].sidebarVisible).toBe(true);
    const restore = container.querySelector<HTMLButtonElement>('button[title="Show sidebar"]');
    expect(restore).not.toBeNull();
    await act(async () => restore!.click());
    expect(store.getState().tabs[0].sidebarVisible).toBe(true);
  });
  it("resizes both side panels with pointer dragging when only resize-by callbacks are supplied", async () => {
    const store = createMultiPanelStore({ idPrefix: "resize-files" });
    store.getState().initialize("/Users/demo", "demo");
    const resizeNavigation = vi.fn();
    const resizePreview = vi.fn();
    await act(async () =>
      root.render(
        <MultiPanelWorkspace
          store={store}
          renderPane={() => <p>Files</p>}
          renderNavigationAside={<nav>Folders</nav>}
          renderAside={<p>Preview</p>}
          onNavigationAsideResizeBy={resizeNavigation}
          onAsideResizeBy={resizePreview}
        />,
      ),
    );
    const drag = async (label: string, end: number) => {
      await act(async () => {
        container
          .querySelector(`[aria-label="${label}"]`)!
          .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 300 }));
        window.dispatchEvent(new MouseEvent("pointermove", { clientX: end }));
        window.dispatchEvent(new MouseEvent("pointerup"));
        window.dispatchEvent(new MouseEvent("pointermove", { clientX: 600 }));
      });
    };
    await drag("Resize file explorer sidebar", 340);
    await drag("Resize preview panel", 260);
    expect(resizeNavigation.mock.calls).toEqual([[40]]);
    expect(resizePreview.mock.calls).toEqual([[40]]);
  });
});
