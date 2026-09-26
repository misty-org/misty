import type { Space } from "@/api/spaces/dto/interfaces/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpaceManagementNavigation } from "../components/SpaceManagementNavigation";

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

  it("offers members and usage, with no Space settings entry", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/chat"]}>
          <SpaceManagementNavigation space={spaceFixture()} />
        </MemoryRouter>,
      );
    });

    const management = container.querySelector('nav[aria-label="Space management"]');
    expect(management?.querySelector('button[aria-label="Members"]')).not.toBeNull();
    expect(management?.querySelector('button[aria-label="Usage"]')).not.toBeNull();
    expect(management?.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelector('[aria-label="Settings"]')).toBeNull();
  });

  it("keeps Space management available to members", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpaceManagementNavigation space={spaceFixture({ role: "member" })} />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('nav[aria-label="Space management"]')).not.toBeNull();
  });
});

function spaceFixture(patch: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    is_default: false,
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
