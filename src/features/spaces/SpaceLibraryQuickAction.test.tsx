import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setFilePickerOpen, libraryData } = vi.hoisted(() => ({
  setFilePickerOpen: vi.fn(),
  libraryData: { canUploadLibrary: true },
}));

vi.mock("@/features/library/library/useSpaceLibraryData", () => ({
  useSpaceLibraryData: () => ({
    ...libraryData,
    canEditLibrary: true,
    setFilePickerOpen,
  }),
}));
vi.mock("@/features/library/library/useSpaceLibraryItemActions", () => ({
  useSpaceLibraryItemActions: () => ({}),
}));
vi.mock("@/features/library/library/useSpaceLibraryCollectionActions", () => ({
  useSpaceLibraryCollectionActions: () => ({}),
}));
vi.mock("@/features/library/library/SpaceLibraryContext", () => ({
  SpaceLibraryProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/features/library/library/SpaceLibraryPrimitives", () => ({
  LibraryCanEditContext: { Provider: ({ children }: { children: ReactNode }) => children },
}));

vi.mock("@/features/library/library/components/SpaceLibraryCollections", () => ({
  SpaceLibraryCollectionOverview: () => null,
}));
vi.mock("@/features/library/library/components/SpaceLibraryOverlays", () => ({
  SpaceLibraryOverlays: () => null,
}));
vi.mock("@/features/library/library/components/SpaceLibraryStatus", () => ({
  SpaceLibraryTopChrome: () => null,
}));
vi.mock("@/features/library/library/librarySurfaces/AlbumsIndex", () => ({
  AlbumsIndex: () => null,
}));
vi.mock("@/features/library/library/librarySurfaces/DateGroupIndex", () => ({
  DateGroupIndex: () => null,
}));
vi.mock("@/features/library/library/librarySurfaces/DuplicatesIndex", () => ({
  DuplicatesIndex: () => null,
}));
vi.mock("@/features/library/library/librarySurfaces/ImportHistoryIndex", () => ({
  ImportHistoryIndex: () => null,
}));
vi.mock("@/features/library/library/librarySurfaces/LibraryCollectionHeader", () => ({
  LibraryCollectionHeader: () => null,
}));
vi.mock("@/features/library/library/librarySurfaces/LibraryItemsRegion", () => ({
  LibraryItemsRegion: () => null,
}));
vi.mock("@/features/library/library/librarySurfaces/MemoryControls", () => ({
  MemoryControls: () => null,
}));
vi.mock("@/features/library/library/librarySurfaces/SharedReferencesIndex", () => ({
  SharedReferencesIndex: () => null,
}));

import { SpaceLibrary } from "@/features/library/library/SpaceLibrary";

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

describe("Space Library upload query action", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    libraryData.canUploadLibrary = true;
    setFilePickerOpen.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("opens the existing file picker state and consumes the upload command", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/library?collection=recent&upload=1"]}>
          <SpaceLibrary spaceId="space-1" />
          <LocationProbe />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(setFilePickerOpen).toHaveBeenCalledWith(true);
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(
      "?collection=recent",
    );
  });
});
