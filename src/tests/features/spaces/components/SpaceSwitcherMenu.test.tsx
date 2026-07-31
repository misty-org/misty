import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceSwitcherMenu } from "@/features/spaces/components/spacePanel/SpaceSwitcherMenu";
import type { Space } from "@/models/interfaces/features/spaces/types";

describe("SpaceSwitcherMenu", () => {
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

  it("contains only Space switching and creation actions", async () => {
    const onAddSpace = vi.fn();
    const onSwitchSpace = vi.fn();

    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpaceSwitcherMenu
            spaces={[spaceFixture(), spaceFixture({ id: "space-2", name: "Chen family" })]}
            activeSpace={spaceFixture()}
            activeSpaceId="space-1"
            canAddSpace
            onAddSpace={onAddSpace}
            onSwitchSpace={onSwitchSpace}
          />
        </MemoryRouter>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label^="Space menu:"]');
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });

    const items = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Design team",
      "Chen family",
      "Add Space",
    ]);
    expect(document.body.textContent).not.toContain("Members");
    expect(document.body.textContent).not.toContain("Settings");
    expect(items[0]?.getAttribute("aria-current")).toBe("true");

    await act(async () => items[1]?.click());
    expect(onSwitchSpace).toHaveBeenCalledWith("space-2");
    expect(onAddSpace).not.toHaveBeenCalled();
  });
});

function spaceFixture(patch: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    owner_user_id: "owner",
    name: "Design team",
    role: "owner",
    member_count: 2,
    pending_count: 0,
    is_shared: true,
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...patch,
  };
}
