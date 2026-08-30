import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChromeTabStrip, workspaceTabDropIndex } from "./ChromeTabStrip";

describe("ChromeTabStrip", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders independently clickable tabs without measured absolute positioning", () => {
    const onSelectTab = vi.fn();
    act(() => {
      root.render(
        <ChromeTabStrip
          tabs={[
            { id: "tab-1", title: "Home", path: "C:/Users/Misty", paneId: "pane-1" },
            {
              id: "tab-2",
              title: "Documents",
              path: "C:/Users/Misty/Documents",
              paneId: "pane-2",
            },
          ]}
          activeTabId="tab-1"
          onAddTab={vi.fn()}
          onCloseTab={vi.fn()}
          onSelectTab={onSelectTab}
        />,
      );
    });

    const tabs = container.querySelectorAll<HTMLElement>(".chrome-tab");
    const secondTab = container.querySelector<HTMLButtonElement>(
      '.chrome-tab[data-tab-id="tab-2"] [role="tab"]',
    );
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.style.position).toBe("");
    expect(tabs[0]?.style.transform).toBe("");

    act(() => secondTab?.click());
    expect(onSelectTab).toHaveBeenCalledWith("tab-2");
  });

  it("keeps close behavior separate from tab selection", () => {
    const onCloseTab = vi.fn();
    const onSelectTab = vi.fn();
    act(() => {
      root.render(
        <ChromeTabStrip
          tabs={[{ id: "tab-1", title: "Home", path: "/Users/Misty", paneId: "pane-1" }]}
          activeTabId="tab-1"
          onAddTab={vi.fn()}
          onCloseTab={onCloseTab}
          onSelectTab={onSelectTab}
        />,
      );
    });

    const closeButton = container.querySelector<HTMLButtonElement>('[aria-label="Close Home"]');
    act(() => closeButton?.click());

    expect(onCloseTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tab-1", path: "/Users/Misty" }),
    );
    expect(onSelectTab).not.toHaveBeenCalled();
  });

  it("marks tabs as Tauri-safe drag sources when reordering is enabled", () => {
    act(() => {
      root.render(
        <ChromeTabStrip
          tabs={[{ id: "tab-1", title: "Home", path: "/", paneId: "pane-1" }]}
          activeTabId="tab-1"
          onAddTab={vi.fn()}
          onCloseTab={vi.fn()}
          onReorderTab={vi.fn()}
          onSelectTab={vi.fn()}
        />,
      );
    });

    const tab = container.querySelector<HTMLElement>('.chrome-tab[data-tab-id="tab-1"]');
    expect(tab?.getAttribute("draggable")).toBe("true");
    expect(tab?.dataset.reorderDragSource).toBe("true");
    expect(tab?.dataset.mistyWindowDragBlock).toBe("true");
  });

  it("calculates final insertion indexes before and after a hovered tab", () => {
    expect(workspaceTabDropIndex(["a", "b", "c"], "a", "c", false)).toBe(1);
    expect(workspaceTabDropIndex(["a", "b", "c"], "a", "c", true)).toBe(2);
    expect(workspaceTabDropIndex(["a", "b", "c"], "c", "a", false)).toBe(0);
  });
});
