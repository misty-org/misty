import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpaceNavRail, spaceDestination } from "@/features/spaces/components/SpaceNavRail";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";

describe("SpaceNavRail", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useSpacesStore.setState({
      spaces: [
        spaceFixture(),
        spaceFixture({ id: "misty", kind: "misty", name: "Misty" }),
        spaceFixture({ id: "space-2", name: "Chen family" }),
      ],
      limits: null,
    });
  });

  it("pins the permanent Misty Space first", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/chat"]}>
          <SpaceNavRail />
        </MemoryRouter>,
      );
    });
    const links = [
      ...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Spaces"] > a'),
    ];
    expect(links[0]?.getAttribute("aria-label")).toBe("Misty Space");
    expect(links[0]?.querySelector('[aria-label="Misty Space profile picture"]')).not.toBeNull();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useSpacesStore.setState({ spaces: [], limits: null });
    container.remove();
  });

  it("renders circular Space profiles inside Misty dock slots", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/chat"]}>
          <SpaceNavRail />
        </MemoryRouter>,
      );
    });

    const active = container.querySelector<HTMLAnchorElement>('[aria-label="Design team Space"]');
    const second = container.querySelector<HTMLAnchorElement>('[aria-label="Chen family Space"]');
    expect(active?.getAttribute("aria-current")).toBe("page");
    expect(active?.className).toContain("rounded-[15px]");
    expect(active?.className).not.toContain("bg-sidebar-accent");
    expect(active?.className).toContain("border-border/70");
    expect(active?.querySelector('[aria-label$="default profile picture"]')?.className).toContain(
      "rounded-full",
    );
    expect(second?.getAttribute("href")).toBe("/spaces/space-2/chat");
    expect(
      container.querySelector<HTMLAnchorElement>('[aria-label="Add Space"]')?.getAttribute("href"),
    ).toBe("/spaces?createSpace=1");
  });

  it("opens a Space from File Manager at its default surface", () => {
    expect(spaceDestination("/files", "space/three")).toBe("/spaces/space%2Fthree");
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
