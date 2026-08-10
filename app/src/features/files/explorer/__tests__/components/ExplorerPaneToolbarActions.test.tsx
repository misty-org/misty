import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExplorerPaneToolbarActions } from "../../components/ExplorerPaneToolbarActions";

describe("ExplorerPaneToolbarActions", () => {
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

  it("exposes the active view and keeps view switching wired", () => {
    const onViewMode = vi.fn();
    act(() => {
      root.render(
        <ExplorerPaneToolbarActions
          path="/Users/misty/Documents"
          viewMode="grid"
          itemScale={2}
          sort={{ column: "name", direction: "asc" }}
          showHidden={false}
          selectedCount={0}
          selectedEntryPath={null}
          hasRemoteSelection={false}
          canOpenWithSelected={false}
          canCalculateDirectorySizes
          onViewMode={onViewMode}
          onItemScale={vi.fn()}
          onSort={vi.fn()}
          onToggleHidden={vi.fn()}
          onRefresh={vi.fn()}
          onCalculateDirectorySizes={vi.fn()}
          onDownload={vi.fn()}
          onOpenWith={vi.fn()}
          onCopyPath={vi.fn()}
        />,
      );
    });

    const toolbar = container.querySelector('[role="toolbar"][aria-label="Layout"]');
    const gridButton = container.querySelector<HTMLButtonElement>('[aria-label="View as grid"]');
    const listButton = container.querySelector<HTMLButtonElement>('[aria-label="View as list"]');

    expect(toolbar?.getAttribute("aria-label")).toBe("Layout");
    expect(gridButton?.getAttribute("aria-pressed")).toBe("true");
    expect(listButton?.getAttribute("aria-pressed")).toBe("false");

    act(() => listButton?.click());
    expect(onViewMode).toHaveBeenCalledWith("list");
  });

  it("anchors file actions in the accessible dropdown menu", () => {
    const onCopyPath = vi.fn();
    act(() => {
      root.render(
        <ExplorerPaneToolbarActions
          path="/Users/misty/Documents"
          viewMode="list"
          itemScale={2}
          sort={{ column: "modified", direction: "desc" }}
          showHidden
          selectedCount={0}
          selectedEntryPath={null}
          hasRemoteSelection={false}
          canOpenWithSelected={false}
          canCalculateDirectorySizes
          onViewMode={vi.fn()}
          onItemScale={vi.fn()}
          onSort={vi.fn()}
          onToggleHidden={vi.fn()}
          onRefresh={vi.fn()}
          onCalculateDirectorySizes={vi.fn()}
          onDownload={vi.fn()}
          onOpenWith={vi.fn()}
          onCopyPath={onCopyPath}
        />,
      );
    });

    const moreButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="More file actions"]',
    );
    act(() => {
      moreButton?.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
        }),
      );
    });

    const copyPathItem = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.includes("Copy Current Path"),
    );
    expect(copyPathItem).toBeTruthy();

    act(() => copyPathItem?.click());
    expect(onCopyPath).toHaveBeenCalledWith("/Users/misty/Documents");
  });
});
