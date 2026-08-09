import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpacesHeader } from "@/features/spaces/components/SpacesHeader";
import type { SpacesTabsSession } from "@/stores/spaces/useSpacesTabsStore";

describe("SpacesHeader", () => {
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

  it("renders Space tabs with one clear add-tab action", async () => {
    const onAddTab = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpacesHeader
            session={sessionFixture()}
            onAddTab={onAddTab}
            onCloseTab={vi.fn()}
            onReorderTab={vi.fn()}
            onSelectTab={vi.fn()}
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="New Space tab"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open File Manager"]')).toBeNull();
    expect(container.querySelector('[aria-label="Open Agents"]')).toBeNull();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="New Space tab"]')
        ?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    const options = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(options.map((option) => option.textContent)).toEqual([
      "Journal",
      "Planner",
      "Chat",
      "Library",
    ]);
    await act(async () => {
      options
        .find((option) => option.textContent === "Planner")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onAddTab).toHaveBeenCalledWith("planner");
  });

  it("keeps app-wide destinations out of the Space toolbar", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpacesHeader
            session={sessionFixture()}
            onAddTab={vi.fn()}
            onCloseTab={vi.fn()}
            onReorderTab={vi.fn()}
            onSelectTab={vi.fn()}
          />
        </MemoryRouter>,
      );
    });
    expect(container.querySelector('[aria-label*="Open Activity"]')).toBeNull();
    expect(container.querySelector('[aria-label="Open Extensions"]')).toBeNull();
    expect(container.querySelector('[aria-label="Open Code"]')).toBeNull();
  });
});

function sessionFixture(): SpacesTabsSession {
  return {
    tabs: [
      {
        id: "space-workspace-tab-0",
        kind: "space",
        title: "Space",
        route: "/spaces/space-1/notes",
      },
    ],
    activeTabId: "space-workspace-tab-0",
    nextTabIndex: 1,
  };
}
