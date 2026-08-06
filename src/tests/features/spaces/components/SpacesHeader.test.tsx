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

  it("renders the current Space's top-level tabs and tool launchers", async () => {
    const onOpenTool = vi.fn();
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpacesHeader
            session={sessionFixture()}
            onOpenTool={onOpenTool}
            onCloseTab={vi.fn()}
            onReorderTab={vi.fn()}
            onSelectTab={vi.fn()}
            onRenameTab={vi.fn()}
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector('[title="New tab"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open File Manager"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open Agents"]')).not.toBeNull();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open Transfers"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenTool).toHaveBeenCalledWith("transfers");
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
