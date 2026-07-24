import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { SpaceSectionNavigation } from "@/features/spaces/components/SpaceSectionNavigation";
import { spaceSectionPath } from "@/features/spaces/components/SpacePanelContent";

describe("SpaceSectionNavigation", () => {
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
    useSpacesStore.setState({ spaces: [] });
    container.remove();
  });

  it("renders the complete Space work surface strip", async () => {
    useSpacesStore.setState({ spaces: [spaceFixture()] });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/library"]}>
          <SpaceSectionNavigation
            spaceId="space-1"
            section="library"
            context={<p>Library context</p>}
          />
        </MemoryRouter>,
      );
    });

    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Chat",
      "Tasks",
      "Notes",
      "Library",
    ]);
    expect(container.textContent).toContain("Library context");
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toContain("Library");
  });

  it("hides inaccessible sections", async () => {
    useSpacesStore.setState({
      spaces: [
        spaceFixture({
          permissions: {
            "messages.read": false,
            "tasks.view": false,
            "library.view": true,
          },
        }),
      ],
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/library"]}>
          <SpaceSectionNavigation spaceId="space-1" section="library" />
        </MemoryRouter>,
      );
    });

    const labels = [...container.querySelectorAll("a")].map((link) => link.textContent?.trim());
    expect(labels).toEqual(["Notes", "Library"]);
  });

  it("keeps Space management out of the primary strip", async () => {
    useSpacesStore.setState({ spaces: [spaceFixture()] });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/chat"]}>
          <SpaceSectionNavigation spaceId="space-1" section="chat" />
        </MemoryRouter>,
      );
    });

    const labels = [...container.querySelectorAll("a")].map((link) => link.textContent?.trim());
    expect(labels).not.toContain("Members");
    expect(labels).not.toContain("Settings");
  });

  it("hides Library when access is denied", async () => {
    useSpacesStore.setState({
      spaces: [spaceFixture({ permissions: { "library.view": false } })],
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/chat"]}>
          <SpaceSectionNavigation spaceId="space-1" section="chat" />
        </MemoryRouter>,
      );
    });

    const labels = [...container.querySelectorAll("a")].map((link) => link.textContent?.trim());
    expect(labels).not.toContain("Notes");
    expect(labels).not.toContain("Library");
  });

  it("builds the settings destination when switching Spaces", () => {
    expect(spaceSectionPath("space-2", "settings", "chat")).toBe("/spaces/space-2/settings/chat");
  });
});

function spaceFixture(patch: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    owner_user_id: "owner",
    name: "Design team",
    role: "owner",
    member_count: 1,
    pending_count: 0,
    is_personal: false,
    is_shared: true,
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...patch,
  };
}
