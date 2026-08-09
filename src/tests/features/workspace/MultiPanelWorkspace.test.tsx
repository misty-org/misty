import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMultiPanelStore, MultiPanelWorkspace } from "@/features/workspace";

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
