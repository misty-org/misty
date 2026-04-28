import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { SpaceSectionNavigation } from "@/features/spaces/components/SpaceSectionNavigation";
import { spaceSectionPath } from "@/features/spaces/components/spacePanel/spacePanelRoute";
import { useActivityStore } from "@/features/activity";

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
    useActivityStore.setState({ allItems: [] });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useSpacesStore.setState({ spaces: [] });
    useActivityStore.setState({ allItems: [] });
    container.remove();
  });

  it("renders the complete Space work surface menu vertically", async () => {
    useSpacesStore.setState({ spaces: [spaceFixture()] });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/library"]}>
          <SpaceSectionNavigation spaceId="space-1" section="library" />
        </MemoryRouter>,
      );
    });

    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Journal",
      "Planner",
      "Chat",
      "Library",
    ]);
    expect(container.querySelector("nav")?.className).toContain("grid");
    expect(container.querySelector("nav")?.className).not.toContain("overflow-x-auto");
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toContain("Library");
    expect(links.find((link) => link.textContent?.trim() === "Planner")?.getAttribute("href")).toBe(
      "/spaces/space-1/planner/tasks/board",
    );
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
    expect(labels).toEqual(["Journal", "Library"]);
  });

  it("keeps Space management out of the section menu", async () => {
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

  it("puts a new-item count on the section that owns the update", async () => {
    useSpacesStore.setState({ spaces: [spaceFixture()] });
    useActivityStore.setState({
      allItems: [
        {
          id: "spaces:9",
          accountId: "account-1",
          source: "spaces",
          sourceId: "9",
          kind: "mention",
          title: "Mention",
          body: "Please review",
          createdAt: "2026-08-08T12:00:00Z",
          attention: true,
          target: { kind: "space-chat", spaceId: "space-1" },
        },
      ],
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner"]}>
          <SpaceSectionNavigation spaceId="space-1" section="planner" />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[aria-label="1 new"]')?.closest("a")?.textContent).toContain(
      "Chat",
    );
    expect(
      [...container.querySelectorAll("a")]
        .find((link) => link.textContent?.includes("Planner"))
        ?.querySelector('[aria-label$="new"]'),
    ).toBeNull();
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
    expect(labels).toContain("Journal");
    expect(labels).not.toContain("Library");
  });

  it("applies normal permissions to the default Misty Space", async () => {
    useSpacesStore.setState({
      spaces: [
        spaceFixture({
          id: "misty",
          kind: "standard",
          permissions: {
            "messages.read": false,
            "tasks.view": false,
            "library.view": false,
          },
        }),
      ],
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/misty/notes"]}>
          <SpaceSectionNavigation spaceId="misty" section="notes" />
        </MemoryRouter>,
      );
    });

    expect([...container.querySelectorAll("a")].map((link) => link.textContent?.trim())).toEqual([
      "Journal",
    ]);
  });

  it("treats Notes and Drawings as Journal destinations", async () => {
    useSpacesStore.setState({ spaces: [spaceFixture()] });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/drawings"]}>
          <SpaceSectionNavigation spaceId="space-1" section="drawings" />
        </MemoryRouter>,
      );
    });

    const active = container.querySelector('a[aria-current="page"]');
    expect(active?.textContent).toContain("Journal");
    expect(active?.getAttribute("href")).toBe("/spaces/space-1/notes");
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
    is_shared: true,
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...patch,
  };
}
