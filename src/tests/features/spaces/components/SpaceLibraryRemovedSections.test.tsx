import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/spaces/SpaceLibraryContext", () => ({
  useSpaceLibraryContext: () => ({
    data: {
      spaceId: "space-1",
      displayItems: [],
      albums: [],
      canEditLibrary: false,
      libraryViewerTriggerRef: { current: null },
      setSelectedItemId: vi.fn(),
      sensitiveCollectionToken: "",
    },
    collectionActions: {
      openCreateAlbum: vi.fn(),
      selectCollection: vi.fn(),
    },
  }),
}));

import { SpaceLibraryCollectionOverview } from "@/features/spaces/components/SpaceLibraryCollections";
import { librarySidebarItems } from "@/features/spaces/components/spacePanel/librarySidebarItems";
import { libraryCollectionKinds } from "@/features/spaces/useSpaceLibraryData";

describe("removed Library sections", () => {
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

  it("omits People and Pets from Library navigation and legacy routes", () => {
    expect(librarySidebarItems.map((item) => item.label)).not.toContain("People");
    expect(libraryCollectionKinds.has("people")).toBe(false);
  });

  it("omits Smart Library from navigation and public collection routes", () => {
    expect(librarySidebarItems.map((item) => item.label)).not.toContain("Smart Library");
    expect(libraryCollectionKinds.has("smart")).toBe(false);
  });

  it("omits Smart Groups from the Collections overview and legacy routes", async () => {
    await act(async () => root.render(<SpaceLibraryCollectionOverview />));

    expect(container.textContent).not.toContain("Groups");
    expect(container.textContent).not.toContain("New smart group");
    expect(libraryCollectionKinds.has("groups")).toBe(false);
  });
});
