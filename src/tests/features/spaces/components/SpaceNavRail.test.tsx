import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SpaceNavRail,
  reorderSpaceIds,
  spaceDestination,
} from "@/features/spaces/components/SpaceNavRail";
import type { Space, SpaceInvitation } from "@/models/interfaces/features/spaces/types";
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
        spaceFixture({ id: "misty", kind: "standard", name: "Misty" }),
        spaceFixture({ id: "space-2", name: "Chen family" }),
      ],
      invitations: [],
      limits: null,
    });
  });

  it("preserves the server-provided Space order", async () => {
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
    expect(links[0]?.getAttribute("aria-label")).toBe("Design team Space");
    expect(links[1]?.getAttribute("aria-label")).toBe("Misty Space");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useSpacesStore.setState({ spaces: [], invitations: [], limits: null });
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
    expect(active?.getAttribute("draggable")).toBe("true");
    expect(active?.dataset.reorderDragSource).toBe("true");
    expect(active?.dataset.mistyWindowDragBlock).toBe("true");
    expect(active?.className).toContain("rounded-full");
    expect(active?.className).not.toContain("bg-sidebar-accent");
    expect(active?.className).not.toContain("border-border/70");
    expect(active?.querySelector('[data-slot="avatar"]')?.className).toContain(
      "group-hover/space:ring-foreground/70",
    );
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

  it("shows an invited Space in the rail before it is accepted", async () => {
    useSpacesStore.setState({ invitations: [invitationFixture()] });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/chat"]}>
          <SpaceNavRail />
        </MemoryRouter>,
      );
    });

    const invitation = container.querySelector<HTMLAnchorElement>(
      '[aria-label="Family Space invitation"]',
    );
    expect(invitation?.getAttribute("href")).toBe("/spaces/family-space/invitation");
    expect(invitation?.dataset.invitationPending).toBe("true");
    expect(invitation?.textContent).toContain("Invitation pending");
  });

  it("reorders Space ids before or after the hovered avatar", () => {
    expect(reorderSpaceIds(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"]);
    expect(reorderSpaceIds(["a", "b", "c"], "a", "c", true)).toEqual(["b", "c", "a"]);
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

function invitationFixture(patch: Partial<SpaceInvitation> = {}): SpaceInvitation {
  return {
    id: "invite-1",
    space_id: "family-space",
    space_name: "Family",
    invited_email: "person@example.com",
    invited_by_user_id: "owner-2",
    inviter_name: "Chen",
    delivery_status: "sent",
    expires_at: "2026-08-12T00:00:00Z",
    created_at: "2026-08-05T00:00:00Z",
    ...patch,
  };
}
