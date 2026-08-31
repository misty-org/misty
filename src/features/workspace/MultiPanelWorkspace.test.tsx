import { createMultiPanelStore, MultiPanelWorkspace } from "@/features/workspace";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
});
