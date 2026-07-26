import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { HomeDashboard } from "@/pages/Home/desktop/HomeDashboard";

const spaces: Space[] = [
  {
    id: "shared-space",
    owner_user_id: "user-1",
    name: "Design team",
    role: "owner",
    member_count: 4,
    pending_count: 0,
    is_personal: false,
    is_shared: true,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-23T00:00:00Z",
  },
  {
    id: "personal-space",
    owner_user_id: "user-1",
    name: "Personal",
    role: "owner",
    member_count: 1,
    pending_count: 0,
    is_personal: true,
    is_shared: false,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-22T00:00:00Z",
  },
];

describe("HomeDashboard", () => {
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

  it("links beta-ready Space tools and future features to their destinations", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <HomeDashboard loading={false} signedIn spaces={spaces} />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('a[href="/spaces/shared-space/chat"]')).not.toBeNull();
    expect(container.querySelector('a[href="/spaces/shared-space/library"]')).not.toBeNull();
    expect(container.querySelector('a[href="/spaces/shared-space/notes"]')).not.toBeNull();
    expect(container.querySelector('a[href="/spaces/shared-space/tasks"]')).not.toBeNull();
    expect(container.querySelector('a[href="/spaces/shared-space/members"]')).not.toBeNull();
    expect(container.querySelector('a[href="/files"]')).not.toBeNull();
    expect(container.querySelector('a[href="/agents"]')).not.toBeNull();
    expect(container.querySelector('a[href="/extensions"]')).not.toBeNull();
    const panelScrollRegions = container.querySelectorAll('[data-slot="dashboard-panel-scroll"]');
    expect(panelScrollRegions).toHaveLength(6);
    panelScrollRegions.forEach((region) => {
      expect(region.className).toContain("overflow-y-auto");
      expect(region.className).toContain("overscroll-contain");
    });

    const dashboardCards = container.querySelectorAll('[data-slot="card"]');
    expect(dashboardCards.length).toBeGreaterThan(0);
    dashboardCards.forEach((card) => {
      expect(card.className).toContain("!bg-transparent");
    });

    const viewport = container.querySelector('[data-slot="home-dashboard-viewport"]');
    expect(viewport).not.toBeNull();
    expect(viewport?.className).toContain("overflow-hidden");
    expect(viewport?.className).not.toContain("overflow-y-auto");

    const dashboard = container.querySelector('[aria-label="Home dashboard"]');
    expect(dashboard?.className).toContain("h-full");
    expect(dashboard?.className).toContain("max-[1180px]:grid-rows-[minmax(0,2fr)_minmax(0,1fr)]");
  });
});
