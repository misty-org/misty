import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpaceManagementNavigation } from "@/features/spaces/components/SpaceManagementNavigation";
import type { Space } from "@/models/interfaces/features/spaces/types";

describe("SpaceManagementNavigation", () => {
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

  it("places member presence and Settings in a compact accessible management group", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/chat"]}>
          <SpaceManagementNavigation space={spaceFixture()} section="chat" />
        </MemoryRouter>,
      );
    });

    const management = container.querySelector('nav[aria-label="Space management"]');
    const links = [...(management?.querySelectorAll("a") ?? [])];
    expect(container.querySelector('button[aria-label="Space team"]')).not.toBeNull();
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual(["Settings"]);
    expect(links.map((link) => link.textContent?.trim())).toEqual([""]);
    expect(links[0]?.getAttribute("href")).toBe("/spaces/space-1/settings/general");
    expect(container.querySelector('[aria-label="More Space actions"]')).toBeNull();
  });

  it("hides global management from ordinary Misty members", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpaceManagementNavigation
            space={spaceFixture({ kind: "misty", permissions: { "space.invite": false } })}
            section="chat"
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('nav[aria-label="Space management"]')).toBeNull();
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
